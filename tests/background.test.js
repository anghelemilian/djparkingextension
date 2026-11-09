'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('background.js', 'utf8');
const model = fs.readFileSync('model.js', 'utf8');
const event = () => ({ addListener() {} });
function harness(routes) {
 const requests = [], saved = {};
 let ctx;
 const chrome = {
  storage: { local: {
   async get(keys) { return typeof keys === 'object' && !Array.isArray(keys) ? {...keys, ...saved} : {...saved}; },
   async set(values) { Object.assign(saved, values); }
  } },
  action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
  tabs: { async query() { return [{id: 1, url: 'https://parcari-ticketing.primariacraiova.ro/'}]; } },
  scripting: { async executeScript({func, args}) { return [{ result: await func(...args) }]; } },
  alarms: { async get() { return {}; }, async create() {}, onAlarm: event() },
  runtime: { onInstalled: event(), onStartup: event(), onMessage: event() }
 };
 ctx = vm.createContext({chrome, crypto: webcrypto, TextEncoder, URL, console,
  async fetch(url, options) {
   requests.push(url);
   assert.equal(options.credentials, 'include');
   assert.equal(options.method, undefined); // read-only default GET
   const data = routes[url];
   return {ok: data !== undefined && data !== 'FAIL', status: data === 'FAIL' ? 401 : 200,
    async json() { return structuredClone(data); }};
  }, importScripts() { vm.runInContext(model, ctx); }
 });
 vm.runInContext(source, ctx);
 return {ctx, saved, requests, collect: () => ctx.collect(30), refresh: () => ctx.refresh()};
}
const person = {_id: 'synthetic-account-a', active: true, address: [{active:true, ID_IMOBIL:1001}]};
const lot = {id:2001, name:'Synthetic lot', can_apply_for_auction:null, can_apply_for_waitlist:true,
 residence_parking_spots:[{id:3001, number:'7', status:'active', spot_type:'normal', availability:'free'}]};
const routesFor = lot => ({'/api/person':person, '/api/ticket/1/5':{items:[]},
 '/api/immobile/1001?distance_to_parking_lot=30':{id:1001, name:'Synthetic building', parking_lots:[lot]}});
(async () => {
 let h = harness(routesFor({...lot, auctions:{unexpected:true}}));
 let s = await h.collect();
 assert.equal(s.properties.length, 1, 'malformed auction metadata must not discard inventory');
 assert.equal(s.properties[0].lots[0].spots.length, 1);
 assert.ok(s.warnings.length);
 h = harness({...routesFor(lot), '/api/person':{_id:person._id, active:true}, '/api/immobiles':{items:person.address}});
 s = await h.collect();
 assert.equal(s.properties[0].id, 1001, 'current frontend address endpoint supported');
 assert.equal(s.properties[0].lots[0].registrationState, 'closed');
 h = harness({...routesFor(lot), '/api/person':{_id:person._id,active:true}, '/api/immobiles':{address:person.address}});
 s = await h.collect(); assert.equal(s.properties[0].id,1001);
 assert.equal(s.properties[0].lots[0].spots[0].allocation, 'unallocated');
 assert.equal(s.properties[0].lots[0].spots[0].count, null);
 const ended = {...lot, can_apply_for_auction:true, auctions:[{id:4001, auction_status:'public',
  auction_start_date_time:'2020-01-01T00:00:00Z', auction_end_date_time:'2020-01-02T00:00:00Z',
  items:[{id_res_parking_spot:3001, registration_count:0}]}]};
 h = harness(routesFor(ended)); s = await h.collect();
 assert.equal(s.properties[0].lots[0].spots[0].auctionState, 'ended');
 assert.equal(s.properties[0].lots[0].spots[0].countKind, 'historical');
 assert.equal(h.ctx.ParkingModel.summarize(s,1001).alternatives.length,0);
 for (const auctions of [undefined, null, [], [null], [{items:{}}]]) {
  h = harness(routesFor({...lot, auctions})); s = await h.collect();
  assert.equal(s.properties[0].lots[0].spots.length,1);
 }
 h = harness(routesFor({...lot, residence_parking_spots:null})); s = await h.collect();
 assert.equal(s.properties[0].lots.length,1);
 assert.equal(s.properties[0].lots[0].inventoryStatus,'unknown');
 h = harness({...routesFor(lot), '/api/immobile/1001?distance_to_parking_lot=30':{id:1001, name:'Building', parking_lots:null}});
 s = await h.collect(); assert.equal(s.properties.length,1,'verified building survives unavailable lots');
 assert.equal(s.properties[0].inventoryStatus,'unknown');
 const olderPublic = {id:4000,auction_status:'public',auction_start_date_time:'2019-01-01T00:00:00Z',
  auction_end_date_time:'2019-01-02T00:00:00Z',items:[{id_res_parking_spot:3001,registration_count:7}]};
 h = harness(routesFor({...ended,auctions:[olderPublic,...ended.auctions]})); s = await h.collect();
 assert.equal(s.properties[0].lots[0].spots[0].auctionId,4001);
 assert.equal(s.properties[0].lots[0].spots[0].count,0);
 h = harness(routesFor({...lot,auctions:[{...olderPublic,auction_start_date_time:null},...ended.auctions]})); s = await h.collect();
 assert.equal(s.properties[0].lots[0].spots[0].count,null,'ambiguous chronology cannot expose an older public count');
 h = harness(routesFor({...lot,can_apply_for_auction:false,residence_parking_spots:[{id:3001,number:'7',status:'active'}]})); s = await h.collect();
 assert.equal(s.properties[0].lots[0].registrationState,'unknown','not eligible does not prove registration closed');
 assert.equal(s.properties[0].lots[0].spots[0].allocation,'unknown','active status is not allocation');
 h = harness({...routesFor(lot), '/api/person':{...person,address:[{active:true,ID_IMOBIL:999},...person.address]},
  '/api/immobile/999?distance_to_parking_lot=30':{id:1001,parking_lots:[lot]}});
 s = await h.collect(); assert.equal(s.properties.length,2);
 assert.equal(s.properties.find(p=>p.id===999).inventoryStatus,'unknown','wrong-property payload cannot be attributed to linked building');
 assert.equal(s.properties.find(p=>p.id===999).lots.length,0);
 h = harness({...routesFor(lot),'/api/person':{...person,address:[]}}); s = await h.collect();
 assert.equal(s.properties.length,0); assert.deepEqual(h.requests,['/api/person']);
 h = harness(routesFor(lot)); await h.refresh();
 h.saved.watches = [{propertyId:1001,lotId:2001,spotId:3001}]; h.saved.history = [{count:99}];
 person._id = 'synthetic-account-b'; await h.refresh();
 assert.equal(h.saved.watches.length,0); assert.equal(h.saved.history.length,0);
 person._id = 'synthetic-account-a';
 const failed = {...routesFor(lot), '/api/person':'FAIL'};
 h = harness(failed); h.saved.snapshot = {properties:[{id:999}]}; await h.refresh();
 assert.equal(h.saved.snapshot,null);
 assert.deepEqual(h.requests,['/api/person']);
 h = harness({...routesFor(lot), '/api/ticket/1/5':'FAIL'}); s = await h.collect();
 assert.equal(s.properties.length,1); assert.equal(s.ticketStatus,'unknown');
 assert.ok(!JSON.stringify(s).includes(person._id));
 console.log('All background tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
