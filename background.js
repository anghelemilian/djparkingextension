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
     person.active === false) {
  throw Error('Unable to verify the signed-in account and its linked properties.');
 }
 // The current official frontend reads linked addresses from /immobiles.
 // Keep the original person.address shape for existing portal versions.
 let addresses = person.address;
 if (!Array.isArray(addresses)) {
  const linked = await get('/api/immobiles');
  addresses = Array.isArray(linked?.address) ? linked.address : linked?.items;
  if (!Array.isArray(addresses)) throw Error('Unexpected linked-property response.');
 }
 const ids = [...new Set(addresses
  .filter(a => a && a.active === true && Number.isSafeInteger(a.ID_IMOBIL) && a.ID_IMOBIL > 0)
  .map(a => a.ID_IMOBIL))].slice(0, 10);

 // Account-scoped cache key; raw user ID never leaves this function.
 const digest = await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode('craiova-parking-extension-account:' + person._id));
 const accountKey = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
 const out = { schemaVersion: 2, accountKey, properties: [], ownAuctions: [], ownAuctionStatus: 'unknown', tickets: [], ticketStatus: 'unknown', warnings: [], at: Date.now() };

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
   if (data?.id !== id) throw Error('Unexpected property response');
   const inventoryStatus = Array.isArray(data.parking_lots) ? 'ok' : 'unknown';
   if (inventoryStatus !== 'ok') out.warnings.push('Property ' + id + ': Parking-lot inventory unavailable; not a confirmed empty building.');
   const lots = (Array.isArray(data.parking_lots) ? data.parking_lots : []).filter(lot => lot && Number.isSafeInteger(lot.id) && lot.id > 0).map(lot => {
    const warn = detail => out.warnings.push('Property ' + id + ', lot ' + lot.id + ': ' + detail);
    const inventoryStatus = Array.isArray(lot.residence_parking_spots) ? 'ok' : 'unknown';
    if (inventoryStatus !== 'ok') warn('Numbered-space inventory missing or malformed; not a confirmed empty lot.');
    const registrationState = lot.can_apply_for_auction === true ? 'eligible' :
     lot.can_apply_for_auction === null && lot.can_apply_for_waitlist === true ? 'closed' : 'unknown';
    if (lot.auctions != null && !Array.isArray(lot.auctions)) warn('Auction metadata malformed; inventory retained.');
    const auctions = (Array.isArray(lot.auctions) ? lot.auctions : []).filter(a => a && !a.deleted_at);
    // Only timezone-qualified timestamps establish chronology. Ambiguous dates
    // must not turn an old public auction into a current opportunity.
    const timestamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
     Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
    const starts = auctions.map(a => timestamp(a.auction_start_date_time));
    let auction = auctions.length === 1 ? auctions[0] : null;
    if (auctions.length > 1 && starts.every(t => t !== null)) {
     const latest = Math.max(...starts);
     if (starts.filter(t => t === latest).length === 1) auction = auctions[starts.indexOf(latest)];
    }
    if (auctions.length && !auction) warn('Auction chronology ambiguous; counts unavailable.');
    const end = timestamp(auction?.auction_end_date_time);
    const auctionState = end !== null && end <= out.at ? 'ended' :
     auction?.auction_status === 'public' ? 'public' :
     auction?.auction_status === 'preauction' ? 'scheduled' :
     auction?.auction_status === 'ongoing' ? 'ongoing' :
     auction?.auction_status === 'archived' ? 'archived' : 'unknown';
    const countKind = ['ended', 'archived'].includes(auctionState) ? 'historical' : 'reported';
    const auctionId = Number.isSafeInteger(auction?.id) && auction.id > 0 ? auction.id : null;
    const items = new Map();
    if (auction && !Array.isArray(auction.items)) warn('Auction items missing or malformed; counts unavailable.');
    for (const item of Array.isArray(auction?.items) ? auction.items : []) {
     if (!item || item.deleted_at || !Number.isSafeInteger(item.id_res_parking_spot)) continue;
     const key = String(item.id_res_parking_spot);
     // Duplicate entries are ambiguous, not evidence of zero demand.
     if (items.has(key)) { items.set(key, null); continue; }
     items.set(key, item);
    }
    // Upcoming-space discovery uses every explicit auction item, independently
    // of the single auction selected above for registration-count provenance.
    const knownSpots = Array.isArray(lot.residence_parking_spots) ? lot.residence_parking_spots : [];
    const auctionEntries = [];
    const positive = n => Number.isSafeInteger(n) && n > 0;
    for (const candidate of auctions) {
     if (!positive(candidate.id) || !Array.isArray(candidate.items)) continue;
     const valid = candidate.items.filter(item => item && !item.deleted_at && positive(item.id) && positive(item.id_res_parking_spot));
     for (const item of valid) {
      if (valid.filter(i => i.id === item.id).length !== 1 ||
          valid.filter(i => i.id_res_parking_spot === item.id_res_parking_spot).length !== 1 ||
          knownSpots.filter(s => s && !s.deleted_at && s.id === item.id_res_parking_spot).length !== 1) continue;
      auctionEntries.push({ auctionId: candidate.id, itemId: item.id, spotId: item.id_res_parking_spot,
       status: ['public','preauction','ongoing','archived'].includes(candidate.auction_status) ? candidate.auction_status : 'unknown',
       itemStatus: item.status === 'inactive' ? 'inactive' : item.status === 'active' ? 'active' : 'unknown',
       start: timestamp(candidate.auction_start_date_time), end: timestamp(candidate.auction_end_date_time)
      });
     }
    }
    return {
     id: lot.id, name: String(lot.name || 'Parking lot'), registrationState, inventoryStatus, auctionEntries,
     auctionState, auctionId, auctionEnd: end, auctionData: lot.auctions == null ? 'not-returned' : Array.isArray(lot.auctions) && !lot.auctions.length ? 'empty' : 'returned',
     distance: lot.distance != null && lot.distance !== '' && Number.isFinite(Number(lot.distance)) ? Number(lot.distance) : null,
     spots: (Array.isArray(lot.residence_parking_spots) ? lot.residence_parking_spots : [])
      .filter(s => s && Number.isSafeInteger(s.id) && s.id > 0 && !s.deleted_at).map(s => {
      const item = items.get(String(s.id));
      const n = item?.registration_count;
      return {
       id: s.id, number: s.number == null ? 'Unknown number' : String(s.number), type: s.spot_type, status: s.status,
       // Only the 'free' availability value is evidenced in the public frontend.
       // Other values (including inactive status) do not prove allocation.
       allocation: s.availability === 'free' ? 'unallocated' : 'unknown',
       count: auctionId !== null && Number.isInteger(n) && n >= 0 ? n : null,
       countKind, auctionId, auctionState, auctionEnd: end, registrationState,
       publicAuction: auctionState === 'public',
       regime: item?.parking_regime_efectiv || item?.parking_regime || s.parking_regime_efectiv || null
      };
     })
    };
   });
   out.properties.push({ id, name: String(data.name || 'Property ' + id), inventoryStatus, lots });
  } catch (e) {
   out.warnings.push('Property ' + id + ': ' + e.message);
   // This ID is already verified through the account's active addresses.
   // Retain the linked building, without attributing a failed/wrong payload.
   out.properties.push({ id, name: 'Linked building ' + id, inventoryStatus: 'unknown', lots: [] });
  }
 }));
 // Optional account-wide lifecycle feed used by the official /licitatii view.
 // It never supplies allocation or replaces the building inventory/counts.
 try {
  const data = await get('/api/auctions');
  if (!Array.isArray(data?.auctions_registrations)) throw Error('Unexpected own-auction response');
  out.ownAuctionStatus = 'ok';
  const positive = n => Number.isSafeInteger(n) && n > 0;
  const timestamp = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
   Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const seen = new Set();
  for (const row of data.auctions_registrations.slice(0, 200)) {
   const auction = row?.auction;
   const items = Array.isArray(auction?.items) ? auction.items.filter(item => item && positive(row?.id_auction_item) && item.id === row.id_auction_item && !item.deleted_at) : [];
   const item = items.length === 1 ? items[0] : null;
   const spotId = item?.id_res_parking_spot ?? item?.residence_parking_spot?.id;
   if (!positive(row?.id_auction) || row.id_auction !== auction?.id || !positive(row.id_auction_item) ||
       !item || !positive(spotId) ||
       (item.residence_parking_spot?.id != null && item.residence_parking_spot.id !== spotId)) {
    out.ownAuctionStatus = 'partial'; continue;
   }
   const key = row.id_auction + '/' + row.id_auction_item;
   if (seen.has(key)) {
    out.ownAuctionStatus = 'partial';
    out.ownAuctions = out.ownAuctions.filter(r => r.auctionId + '/' + r.itemId !== key);
    continue;
   }
   seen.add(key);
   // Strict allowlist. No prices, bids, owners, geometry or raw records leave the tab.
   out.ownAuctions.push({ auctionId: row.id_auction, itemId: row.id_auction_item, spotId,
    number: String(item.residence_parking_spot?.number ?? 'Unknown number'),
    itemStatus: item.status === 'inactive' ? 'inactive' : item.status === 'active' ? 'active' : 'unknown',
    status: ['public','preauction','ongoing','archived'].includes(auction.auction_status) ? auction.auction_status : 'unknown',
    start: timestamp(auction.auction_start_date_time), end: timestamp(auction.auction_end_date_time)
   });
  }
  if (data.auctions_registrations.length > 200) out.ownAuctionStatus = 'partial';
  if (out.ownAuctionStatus === 'partial') out.warnings.push('Own-auction list partially usable; invalid or excess records were omitted.');
 } catch (e) {
  out.ownAuctionStatus = 'unknown';
  out.ownAuctions = [];
  out.warnings.push('Own auction timeline: ' + e.message);
 }
 // Recheck after optional feeds so an account switch during collection cannot
 // publish a snapshot assembled across two sessions. Raw identity stays here.
 const verified = await get('/api/person');
 if (verified?._id !== person._id || verified.active === false) throw Error('Signed-in account changed during refresh; retry.');
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
   const compatible = sameAccount && saved.snapshot?.schemaVersion === 2;
   const selected = sameAccount && snapshot.properties.some(p => p.id === saved.propertyId)
    ? saved.propertyId : (snapshot.properties[0]?.id ?? null);
   const watches = sameAccount ? (saved.watches || []) : [];
   const recent = compatible ? ParkingModel.changes(saved.snapshot, snapshot) : [];
   const history = compatible ? [...recent.reverse(), ...(saved.history || [])].slice(0, 50) : [];
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
