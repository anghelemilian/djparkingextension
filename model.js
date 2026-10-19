'use strict';
globalThis.ParkingModel = {
 summarize(snapshot, propertyId, watches = []) {
  const property = (snapshot?.properties || []).find(p => String(p.id) === String(propertyId));
  const spaces = (property?.lots || []).flatMap(lot =>
   (lot.spots || []).map(spot => ({ ...spot, lotId: lot.id, lotName: lot.name, distance: lot.distance })));
  const auctioned = spaces.filter(s => s.publicAuction === true && Number.isInteger(s.count));
  const ticketStatus = snapshot?.ticketStatus === 'ok' ? 'ok' : 'unknown';
  const own = (snapshot?.tickets || [])
   .filter(t => t.status === 'open' && t.type === 'LICITATIE_CRAIOVA' && String(t.propertyId) === String(propertyId))
   .map(t => ({ ...t, space: spaces.find(s => String(s.id) === String(t.spotId)) }));
  const watched = (watches || [])
   .filter(w => String(w.propertyId) === String(propertyId))
   .map(w => spaces.find(s => String(s.id) === String(w.spotId) && String(s.lotId) === String(w.lotId)))
   .filter(Boolean);
  const monitored = [...own.map(t => t.space).filter(Boolean), ...watched]
   .filter((s, i, all) => all.findIndex(other => String(other.id) === String(s.id)) === i);
  const competing = own.filter(t => t.space && t.space.count > 1);
  const alerts = monitored.filter(s => Number.isInteger(s.count) && s.count > 1);
  const mode = own.length ? 'monitoring' : ticketStatus === 'ok' ? 'discovery' : 'unknown';
  const ownIds = new Set(own.map(t => String(t.spotId)));
  const alternatives = (mode !== 'monitoring' || alerts.length > 0)
   ? auctioned
      .filter(s => s.count === 0 && s.status === 'active' && s.type === 'normal' && !ownIds.has(String(s.id)))
      .sort((a, b) => {
       const referenceLot = alerts[0]?.lotId;
       const sameLot = referenceLot == null ? 0 :
        Number(String(a.lotId) !== String(referenceLot)) - Number(String(b.lotId) !== String(referenceLot));
       return sameLot || (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
        String(a.number).localeCompare(String(b.number), undefined, { numeric: true });
      })
   : [];
  return {
   property, spaces, auctioned, own, watched, monitored, competing, alerts, alternatives, mode, ticketStatus,
   zero: auctioned.filter(s => s.count === 0).length,
   registered: auctioned.filter(s => s.count > 0).length,
   multiple: auctioned.filter(s => s.count > 1).length
  };
 },
 changes(previous, current) {
  if (!previous) return [];
  const prior = new Map((previous.properties || []).flatMap(p =>
   (p.lots || []).flatMap(l => (l.spots || []).map(s => [p.id + '/' + l.id + '/' + s.id, s.count]))));
  return (current.properties || []).flatMap(p => (p.lots || []).flatMap(l => (l.spots || []).flatMap(s => {
   const old = prior.get(p.id + '/' + l.id + '/' + s.id);
   return Number.isInteger(old) && Number.isInteger(s.count) && old !== s.count
    ? [{ propertyId: p.id, lot: l.name, space: s.number, old, count: s.count, at: current.at }]
    : [];
  })));
 }
};
