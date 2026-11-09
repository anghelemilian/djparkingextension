'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
const node = id => { if(!nodes.has(id)) nodes.set(id,{textContent:'',innerHTML:'',value:'',addEventListener(){},querySelectorAll(){return []}}); return nodes.get(id); };
const ctx=vm.createContext({document:{getElementById:node}, console,
 chrome:{storage:{local:{async get(){return {}}},onChanged:{addListener(){}}},runtime:{sendMessage(){return new Promise(()=>{})}}}});
vm.runInContext(fs.readFileSync('model.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('popup.js','utf8'),ctx);
const render = snapshot => {ctx.input=snapshot;vm.runInContext('state={snapshot:input,propertyId:1001};busy=false;verifiedThisOpen=true;render()',ctx);return node('content').innerHTML;};
const lot={id:2001,name:'Synthetic <lot>',registrationState:'closed',inventoryStatus:'ok',auctionState:'ended', spots:[
 {id:3001,number:'7',count:0,countKind:'historical',auctionId:4001,auctionState:'ended',auctionEnd:1,allocation:'unknown'},
 {id:3002,number:'8',count:null,allocation:'unallocated'}]};
const snapshot={at:1000,tickets:[],ticketStatus:'ok',properties:[{id:1001,name:'Building',lots:[lot]}]};
let html=render(snapshot);
assert.match(html,/Registration\/selection closed/);
assert.match(html,/Auction ended/);
assert.match(html,/Allocation unknown/);
assert.match(html,/Unallocated \(portal report\)/);
assert.match(html,/Historical: 0 registrations/);
assert.match(html,/Synthetic &lt;lot&gt;/);
assert.match(html,/data-spot="3001"/);
assert.doesNotMatch(html,/0 auction spaces registered \(0%\)/);
html=render({...snapshot,properties:[{id:1001,name:'Building',lots:[]}]});
assert.match(html,/No parking lots returned/);
html=render({...snapshot,properties:[{id:1001,lots:[{...lot,spots:[],inventoryStatus:'unknown'}]}]});
assert.match(html,/Numbered-space inventory unavailable/);
html=render({...snapshot,properties:[{id:1001,lots:[{...lot,spots:[]}]}]});
assert.match(html,/No numbered spaces returned/);
for (const [auctionState, label] of [['scheduled','Auction scheduled'],['ongoing','Bidding in progress'],['archived','Auction archived']]) {
 html=render({...snapshot,properties:[{id:1001,lots:[{...lot,auctionState}]}]});
 assert.ok(html.includes(label));
}
console.log('All popup tests passed');
(async()=>{
 ctx.chrome.runtime.sendMessage=async()=>{throw Error('Service worker unavailable');};
 await vm.runInContext('refresh()',ctx);
 assert.match(node('content').innerHTML,/Connect your session/,'transport failure hides cached account inventory');
 assert.doesNotMatch(node('content').innerHTML,/data-spot/);
 console.log('Popup transport failure test passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
