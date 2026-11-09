'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ctx={};vm.runInNewContext(fs.readFileSync('model.js','utf8'),ctx);const m=ctx.ParkingModel;
const future=Date.now()+86400000;
const entry=(auctionId,itemId,spotId,status='preauction',extra={})=>({auctionId,itemId,spotId,status,start:future,end:future+3600000,itemStatus:'active',...extra});
const make=entries=>({properties:[{id:1001,lots:[{id:2001,name:'Lot A',distance:12,spots:[{id:3001,number:'7',status:'active',count:9},{id:3002,number:'8',status:'active',count:0}],auctionEntries:entries}]}],ownAuctions:[]});
let snapshot=make([entry(4001,5001,3001)]);
let result=m.auctionSpaces(snapshot,1001);
assert.equal(result.scheduled.length,1);assert.equal(result.scheduled[0].number,'7');assert.equal(result.scheduled[0].lotName,'Lot A');
assert.equal(m.auctionSpaces(snapshot,9999).scheduled.length,0);
assert.equal(m.auctionSpaces(make([]),1001).scheduled.length,0,'multiple registrations alone never prove an upcoming auction');
assert.equal(m.auctionSpaces(make([entry(4001,5001,3002)]),1001).scheduled.length,1,'explicit scheduled zero-count item is still scheduled');
for(const record of [entry(1,2,3001,'archived'),entry(1,2,3001,'public'),entry(1,2,3001,'preauction',{end:1}),entry(1,2,3001,'preauction',{itemStatus:'inactive'}),entry(1,2,9999)]) {
 assert.equal(m.auctionSpaces(make([record]),1001).scheduled.length,0);
}
result=m.auctionSpaces(make([entry(1,2,3001,'ongoing')]),1001);assert.equal(result.ongoing.length,1);
result=m.auctionSpaces(make([entry(1,2,3001,'preauction',{start:null,end:null})]),1001);assert.equal(result.scheduled.length,1,'portal schedule may lack a usable date');
snapshot=make([]);snapshot.ownAuctions=[entry(4001,5001,3001)];assert.equal(m.auctionSpaces(snapshot,1001).scheduled.length,1,'own feed can confirm a visible space without lot auction metadata');
snapshot=make([entry(4001,5001,3001)]);snapshot.ownAuctions=[entry(4001,5001,3001)];assert.equal(m.auctionSpaces(snapshot,1001).scheduled.length,1,'same auction item deduplicated');
snapshot.ownAuctions=[entry(4001,5001,3001,'archived')];result=m.auctionSpaces(snapshot,1001);assert.equal(result.scheduled.length,0,'conflicting sources cannot assert scheduled');assert.equal(result.conflicts,1);
snapshot=make([entry(4001,5001,3001),entry(4002,5002,3002)]);assert.equal(m.auctionSpaces(snapshot,1001).scheduled.length,2,'retain all scheduled items, not just one chosen auction');
snapshot=make([]);snapshot.ownAuctions=[entry(4001,5001,9999)];assert.equal(m.auctionSpaces(snapshot,1001).scheduled.length,0,'unmatched own registration is not attributed to this building');
snapshot.properties[0].lots.push({...snapshot.properties[0].lots[0],id:2002});snapshot.ownAuctions=[entry(4001,5001,3001)];assert.equal(m.auctionSpaces(snapshot,1001).scheduled.length,0,'ambiguous space-to-lot join cannot assert location');
result=m.auctionSpaces(make([entry(4001,5001,3001,'preauction',{start:future+7200000,end:future})]),1001);assert.equal(result.scheduled.length,0,'impossible time interval is not an upcoming auction');

snapshot=make([entry(4001,5001,3001,'preauction',{start:future+7200000,end:null})]);snapshot.ownAuctions=[entry(4001,5001,3001,'preauction',{start:null,end:future})];result=m.auctionSpaces(snapshot,1001);assert.equal(result.scheduled.length,0,'complementary source dates cannot form an impossible merged interval');assert.equal(result.conflicts,1);
console.log('All auction-space tests passed');
