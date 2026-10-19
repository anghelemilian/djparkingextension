'use strict';
importScripts('model.js');

const ORIGIN = 'https://parcari-ticketing.primariacraiova.ro';
const DEFAULTS = { radius: 30, interval: 1 };
let inFlight = null;

// Executed in the authenticated portal tab. Return only dashboard fields,
// not the person record, documents, or any authentication material.
async function collect(radius) {
 const get = async path => {
  const response = await fetch(path, {
   credentials: 'include',
   cache: 'no-store',
   headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw Error(path + ' HTTP ' + response.status);
  return response.json();
 };

 // Fail closed. Never read a property ID supplied by the extension or saved
 // from a different account when /api/person is unavailable.
 const person = await get('/api/person');
 if (!person || typeof person._id !== 'string' || !person._id.trim() ||
     !Array.isArray(person.address) || person.active === false) {
  throw Error('Unable to verify the signed-in account and its linked properties.');
 }
 const ids = [...new Set(person.address
  .filter(a => a && a.active === true && Number.isSafeInteger(a.ID_IMOBIL) && a.ID_IMOBIL > 0)
  .map(a => a.ID_IMOBIL))].slice(0, 10);

 // Account-scoped cache key; raw user ID never leaves this function.
 const digest = await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode('craiova-parking-extension-account:' + person._id));
 const accountKey = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
 const out = { accountKey, properties: [], tickets: [], ticketStatus: 'unknown', warnings: [], at: Date.now() };

 // A valid account with no linked addresses must not receive anybody else's lot.
 if (!ids.length) return out;

 try {
  let complete = false;
  for (let page = 1; page <= 10; page++) {
   const data = await get('/api/ticket/' + page + '/5');
   if (!Array.isArray(data.items)) throw Error('Invalid ticket response');
   for (const t of data.items) {
    if (t.ticket_type !== 'LICITATIE_CRAIOVA' || !ids.includes(t.ID_IMOBIL)) continue;
    out.tickets.push({
     propertyId: t.ID_IMOBIL, lotId: t.ID_PARCAJ_BATERIE,
     spotId: t.ID_NR_LOC_PARCARE, type: t.ticket_type,
     status: t.status, regime: t.REGIM_PARCARE
    });
   }
   if (data.items.length < 5 ||
       (Number.isSafeInteger(data.total) && page * 5 >= data.total)) {
    complete = true;
    break;
   }
  }
  if (complete) out.ticketStatus = 'ok';
  else out.warnings.push('Ticket list incomplete; registration status cannot be confirmed.');
 } catch (e) {
  out.warnings.push('Tickets: ' + e.message);
 }

 await Promise.all(ids.map(async id => {
  try {
   const data = await get('/api/immobile/' + encodeURIComponent(id) +
    '?distance_to_parking_lot=' + encodeURIComponent(radius));
   // Reject wrong or malformed responses instead of attributing them to an address.
   if (data?.id !== id || !Array.isArray(data.parking_lots)) throw Error('Unexpected property response');
   const lots = data.parking_lots.map(lot => {
    const auctions = [...(lot.auctions || [])].sort((a, b) =>
     Number(b.auction_status === 'public') - Number(a.auction_status === 'public') ||
     String(b.auction_start_date_time || '').localeCompare(String(a.auction_start_date_time || '')));
    const items = new Map();
    for (const auction of auctions) for (const item of auction.items || []) {
     if (item.deleted_at || items.has(String(item.id_res_parking_spot))) continue;
     const n = item.registration_count;
     items.set(String(item.id_res_parking_spot), {
      count: Number.isInteger(n) && n >= 0 ? n : null,
      publicAuction: auction.auction_status === 'public',
      regime: item.parking_regime_efectiv || item.parking_regime
     });
    }
    return {
     id: lot.id, name: String(lot.name || 'Parking lot'),
     distance: Number.isFinite(Number(lot.distance)) ? Number(lot.distance) : null,
     spots: (lot.residence_parking_spots || []).map(s => {
      const auction = items.get(String(s.id));
      return {
       id: s.id, number: String(s.number), type: s.spot_type, status: s.status,
       count: auction?.count ?? null, publicAuction: auction?.publicAuction === true,
       regime: auction?.regime || s.parking_regime_efectiv || null
      };
     })
    };
   });
   out.properties.push({ id, name: String(data.name || 'Property ' + id), lots });
  } catch (e) {
   out.warnings.push('Property ' + id + ': ' + e.message);
  }
 }));
 out.properties.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
 return out;
}

async function badge(snapshot, propertyId, watches = []) {
 const property = snapshot?.properties?.find(p => p.id === propertyId);
 const count = property ? ParkingModel.summarize(snapshot, property.id, watches).alerts.length : 0;
 await chrome.action.setBadgeText({ text: count ? String(count) : '' });
 if (count) await chrome.action.setBadgeBackgroundColor({ color: '#b93623' });
}

async function schedule() {
 const c = await chrome.storage.local.get(DEFAULTS);
 await chrome.alarms.create('poll', {
  periodInMinutes: [1, 2, 5, 10].includes(c.interval) ? c.interval : 1
 });
}

async function hideUnverified(error) {
 // Clear potentially stale on-screen information when authentication or tab
 // access fails. Preserve account-bound watches only until next verified login.
 await chrome.storage.local.set({ snapshot: null, error });
 await badge(null);
 return { ok: false, error };
}

async function refresh() {
 if (inFlight) return inFlight;
 inFlight = (async () => {
  const c = await chrome.storage.local.get(DEFAULTS);
  const tabs = await chrome.tabs.query({ url: ORIGIN + '/*' });
  const tab = tabs.find(t => t.id && t.url && !new URL(t.url).pathname.startsWith('/api/'));
  if (!tab) return hideUnverified('Sign in to the parking portal and keep its tab open.');
  try {
   const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN', func: collect, args: [c.radius]
   });
   const snapshot = result[0]?.result;
   if (!snapshot || typeof snapshot.accountKey !== 'string' ||
       !Array.isArray(snapshot.properties) || !Array.isArray(snapshot.tickets)) {
    throw Error('Could not verify the account response.');
   }
   const saved = await chrome.storage.local.get(['snapshot', 'history', 'watches', 'propertyId', 'accountKey']);
   // Existing pre-fix snapshots have no accountKey, so they are never reused.
   const sameAccount = !!saved.accountKey && saved.accountKey === snapshot.accountKey;
   const selected = sameAccount && snapshot.properties.some(p => p.id === saved.propertyId)
    ? saved.propertyId : (snapshot.properties[0]?.id ?? null);
   const watches = sameAccount ? (saved.watches || []) : [];
   const recent = sameAccount ? ParkingModel.changes(saved.snapshot, snapshot) : [];
   const history = sameAccount ? [...recent.reverse(), ...(saved.history || [])].slice(0, 50) : [];
   await chrome.storage.local.set({
    accountKey: snapshot.accountKey, propertyId: selected,
    watches, history, snapshot, error: null
   });
   await badge(snapshot, selected, watches);
   return { ok: true, accountChanged: !sameAccount };
  } catch (e) {
   return hideUnverified('Refresh failed: ' + e.message);
  }
 })();
 try { return await inFlight; } finally { inFlight = null; }
}

chrome.runtime.onInstalled.addListener(() => { schedule().then(refresh).catch(console.error); });
chrome.runtime.onStartup.addListener(() => { schedule().then(refresh).catch(console.error); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'poll') refresh().catch(console.error); });
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
 (async () => {
  if (msg.type === 'refresh') return refresh();
  if (msg.type === 'watch') {
   const c = await chrome.storage.local.get(['snapshot', 'watches', 'propertyId', 'accountKey']);
   if (!c.snapshot?.accountKey || c.snapshot.accountKey !== c.accountKey) {
    return { ok: false, error: 'Refresh the authenticated account first.' };
   }
   const propertyId = Number(msg.propertyId), lotId = Number(msg.lotId), spotId = Number(msg.spotId);
   const property = c.snapshot.properties.find(p => p.id === propertyId);
   const exists = (property?.lots || []).some(l => l.id === lotId &&
    l.spots.some(s => s.id === spotId));
   if (!exists) return { ok: false, error: 'Space is not linked to the current account property.' };
   const watches = (c.watches || []).filter(w =>
    !(w.propertyId === propertyId && w.lotId === lotId && w.spotId === spotId));
   if (msg.enabled === true) watches.push({ propertyId, lotId, spotId });
   await chrome.storage.local.set({ watches });
   await badge(c.snapshot, c.propertyId, watches);
   return { ok: true };
  }
  if (msg.type === 'config') {
   const update = {};
   if (msg.propertyId !== undefined) {
    const c = await chrome.storage.local.get(['snapshot', 'accountKey']);
    const id = Number(msg.propertyId);
    if (!c.snapshot?.accountKey || c.snapshot.accountKey !== c.accountKey ||
        !c.snapshot.properties.some(p => p.id === id)) {
     return { ok: false, error: 'Property is not linked to the verified account.' };
    }
    update.propertyId = id;
   }
   if ([1, 2, 5, 10].includes(Number(msg.interval))) update.interval = Number(msg.interval);
   if ([30, 50, 100].includes(Number(msg.radius))) update.radius = Number(msg.radius);
   await chrome.storage.local.set(update);
   if (update.interval) await schedule();
   if (update.propertyId !== undefined) {
    const c = await chrome.storage.local.get(['snapshot', 'watches']);
    await badge(c.snapshot, update.propertyId, c.watches || []);
   }
   if (update.radius) return refresh();
   return { ok: true };
  }
  return { ok: false, error: 'Unknown command' };
 })().then(reply).catch(e => reply({ ok: false, error: e.message }));
 return true;
});
chrome.alarms.get('poll').then(a => { if (!a) schedule(); }).catch(console.error);
