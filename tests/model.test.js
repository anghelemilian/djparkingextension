'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../model.js'), 'utf8'), ctx);
const model = ctx.ParkingModel;
const spot = (id, number, count, type = 'normal', status = 'active', publicAuction = true) =>
 ({ id, number, count, type, status, publicAuction, auctionId:4001, auctionEnd:Date.now()+86400000, auctionState:'public', registrationState:'eligible', countKind:'reported' });
const make = (count, ticketStatus = 'ok', tickets = [{
 propertyId: 1001, lotId: 2001, spotId: 3001, status: 'open', type: 'LICITATIE_CRAIOVA'
}]) => ({
 at: 1000, ticketStatus,
 properties: [{ id: 1001, name: 'Test', lots: [
  { id: 2001, name: 'A', distance: 7, spots: [
   spot(3001, '7', count), spot(3002, '1', 0), spot(3003, '4', 0, 'handicap'),
   spot(3004, '5', 0, 'normal', 'inactive'), spot(3005, '6', 0, 'normal', 'active', false)
  ] },
  { id: 2002, name: 'B', distance: 27, spots: [spot(3006, '9', 0)] }
 ] }],
 tickets
});
const watching = [{ propertyId: 1001, lotId: 2001, spotId: 3001 }];
assert.equal(model.summarize(make(1), 1001).mode, 'monitoring');
assert.equal(model.summarize(make(1), 1001).alerts.length, 0);
const contested = model.summarize(make(2), 1001);
assert.equal(contested.competing.length, 1);
assert.equal(contested.alerts.length, 1);
assert.deepEqual(Array.from(contested.alternatives, s => s.number), ['1', '9']);
assert.equal(model.summarize(make(0, 'ok', []), 1001).mode, 'discovery');
assert.deepEqual(Array.from(model.summarize(make(0, 'ok', []), 1001).alternatives, s => s.number), ['1', '7', '9']);
assert.equal(model.summarize(make(0, 'unknown', []), 1001).mode, 'unknown');
assert.equal(model.summarize(make(2, 'ok', []), 1001, watching).alerts.length, 1);
assert.equal(model.summarize(make(1, 'ok', []), 1001, watching).alerts.length, 0);
assert.equal(model.summarize(make(2, 'unknown', []), 1001, watching).alerts.length, 1);
assert.equal(model.summarize(make(2, 'ok', []), 1001, [...watching, ...watching]).monitored.length, 1);
assert.equal(model.summarize(make(2, 'ok', []), 1001, [{ propertyId: 1002, lotId: 2001, spotId: 3001 }]).watched.length, 0);
assert.equal(model.changes(make(1), make(2)).length, 1);
const closed = make(2);
for (const lot of closed.properties[0].lots) for (const s of lot.spots) {
 s.registrationState = 'closed';
}
assert.equal(model.summarize(closed,1001,watching).alerts.length,0, 'closed registration demand cannot alert');
assert.equal(model.summarize(closed,1001).alternatives.length,0);
assert.equal(model.summarize(closed,1001).spaces.length,6);
const alreadyApplied = make(2);
for (const lot of alreadyApplied.properties[0].lots) for (const s of lot.spots) s.registrationState='unknown';
assert.equal(model.summarize(alreadyApplied,1001,watching).alerts.length,1,'account eligibility is not required to monitor an existing application');
assert.equal(model.summarize(alreadyApplied,1001).alternatives.length,0,'unknown eligibility cannot produce new application candidates');
const ended = make(2);
ended.properties[0].lots[0].spots[0].auctionEnd = 1;
assert.equal(model.summarize(ended,1001,watching).alerts.length,0);
assert.equal(model.summarize(ended,1001).spaces[0].auctionState,'ended');
const nextAuction = make(2);
nextAuction.properties[0].lots[0].spots[0].auctionId = 4002;
assert.equal(model.changes(make(1),nextAuction).length,0,'different auction counts cannot be compared');
const unverified = make(2);
delete unverified.properties[0].lots[0].spots[0].auctionId;
assert.equal(model.summarize(unverified,1001,watching).alerts.length,0);
assert.equal(model.changes(make(1),unverified).length,0);

console.log('All model tests passed');
