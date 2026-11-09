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
   const entry = routes[url];
   const data = typeof entry === 'function' ? entry() : entry;
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
 for (const [status, expected] of [['preauction','scheduled'],['ongoing','ongoing'],['archived','archived']]) {
  h = harness(routesFor({...ended,auctions:[{...ended.auctions[0],auction_status:status,auction_end_date_time:'2099-01-02T00:00:00Z'}]}));
  s = await h.collect(); assert.equal(s.properties[0].lots[0].spots[0].auctionState,expected);
  if (status==='archived') assert.equal(s.properties[0].lots[0].spots[0].countKind,'historical');
 }
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
 const registration = {id_auction:4001,id_auction_item:5001, personal:'DO-NOT-RETAIN', auction:{id:4001,
  auction_status:'preauction',auction_start_date_time:'2099-01-01T00:00:00Z',auction_end_date_time:'2099-01-02T00:00:00Z',
  items:[{id:5001,id_res_parking_spot:3001,residence_parking_spot:{id:3001,number:'7',owner:'DO-NOT-RETAIN'},previous_bids:[{name:'DO-NOT-RETAIN'}]}]}};
 h=harness({...routesFor(lot),'/api/auctions':{auctions_registrations:[registration],waitlist:[]}});s=await h.collect();
 assert.equal(s.ownAuctionStatus,'ok'); assert.equal(s.ownAuctions.length,1);
 assert.equal(s.ownAuctions[0].spotId,3001); assert.equal(s.ownAuctions[0].auctionId,4001);
 assert.ok(!JSON.stringify(s).includes('DO-NOT-RETAIN'));
 assert.equal(s.properties[0].lots[0].spots[0].count,null,'own timeline never invents or overwrites inventory counts');
 for(const bad of [null,{}, {auctions_registrations:null}]) {
  h=harness({...routesFor(lot),'/api/auctions':bad});s=await h.collect();
  assert.equal(s.ownAuctionStatus,'unknown');assert.equal(s.properties.length,1);
 }
 for(const badRow of [null,{...registration,id_auction:999}, {...registration,id_auction_item:999},
  {...registration,auction:{...registration.auction,items:[...registration.auction.items,...registration.auction.items]}}]) {
  h=harness({...routesFor(lot),'/api/auctions':{auctions_registrations:[badRow]}});s=await h.collect();
  assert.equal(s.ownAuctions.length,0,'never fall back to first auction item or mismatched parent');
  assert.equal(s.ownAuctionStatus,'partial');
 }
 h=harness({...routesFor(lot),'/api/auctions':{auctions_registrations:[]}});s=await h.collect();
 assert.equal(s.ownAuctionStatus,'ok');assert.equal(s.ownAuctions.length,0);
 const conflict = {...registration,auction:{...registration.auction,auction_status:'archived'}};
 h=harness({...routesFor(lot),'/api/auctions':{auctions_registrations:[registration,conflict]}});s=await h.collect();
 assert.equal(s.ownAuctionStatus,'partial');assert.equal(s.ownAuctions.length,0,'conflicting duplicate rows are suppressed');
 h=harness({...routesFor(lot),'/api/auctions':{auctions_registrations:[{auction:{items:[null]}},registration]}});s=await h.collect();
 assert.equal(s.ownAuctionStatus,'partial','malformed row cannot mark an interrupted list complete');
 assert.equal(s.ownAuctions.length,1,'valid later rows survive malformed optional records');
 let verificationReads=0;
 h=harness({...routesFor(lot),'/api/person':()=>({...person,_id:++verificationReads===1?'account-a':'account-b'}),'/api/auctions':{auctions_registrations:[]}});
 await assert.rejects(h.collect(),/account changed/i,'mid-refresh account switch rejects mixed results');
 const scheduledAuction={id:6001,auction_status:'preauction',auction_start_date_time:'2099-01-01T00:00:00Z',auction_end_date_time:'2099-01-02T00:00:00Z',items:[{id:7001,id_res_parking_spot:3001,status:'active'},{id:7002,id_res_parking_spot:9999,status:'active'}]};
 h=harness(routesFor({...lot,auctions:[...ended.auctions,scheduledAuction]}));s=await h.collect();
 assert.equal(s.properties[0].lots[0].auctionEntries.length,1,'only exact known spaces linked to valid auction items');
 assert.equal(s.properties[0].lots[0].auctionEntries[0].auctionId,6001);
 assert.equal(s.properties[0].lots[0].auctionEntries[0].itemId,7001);
 const polygon={type:'Polygon',coordinates:[[[23.8,44.3],[23.8001,44.3],[23.8001,44.3001],[23.8,44.3]]],privateNote:'DO-NOT-RETAIN'};
 h=harness(routesFor({...lot,geometry:polygon,residence_parking_spots:[{...lot.residence_parking_spots[0],geometry:polygon}]}));s=await h.collect();
 assert.equal(s.properties[0].lots[0].geometry.type,'Polygon');
 assert.equal(s.properties[0].lots[0].spots[0].geometry.coordinates[0].length,4);
 assert.ok(!JSON.stringify(s).includes('DO-NOT-RETAIN'));
 for(const geometry of [{type:'Point',coordinates:[23.8,44.3]},{type:'Polygon',coordinates:[[[999,44],[23,44],[23,45],[999,44]]]}, {type:'Polygon',coordinates:[[[23,44],[23.1,44],[23.1,44.1]]]}]){
  h=harness(routesFor({...lot,geometry}));s=await h.collect();assert.equal(s.properties[0].lots[0].geometry,null,'malformed/unbounded geometry is omitted');
 }
 console.log('All background tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
