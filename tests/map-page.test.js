'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',disabled:false,children:[],addEventListener(){},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}});return nodes.get(id)};
const geometry={type:'Polygon',coordinates:[[[23.8,44.3],[23.801,44.3],[23.801,44.301],[23.8,44.3]]]};
let saved={accountKey:'a',propertyId:1,watches:[],snapshot:{accountKey:'a',at:1000,properties:[{id:1,name:'Building',lots:[{id:2,name:'Lot',spots:[{id:3,number:'7',geometry}]}]}]}};
const maps=[];class MapStub{constructor(o){this.styles=[o.style];this.handlers={};this.sources={};this.layers={};maps.push(this)}on(name,...args){this.handlers[name]=args.at(-1);return this}addControl(){}isStyleLoaded(){return true}getSource(id){return this.sources[id]}addSource(id,o){this.sources[id]={setData(){},...o}}getLayer(id){return this.layers[id]}addLayer(o){this.layers[o.id]=o}fitBounds(){}setFilter(){}setStyle(s){this.styles.push(s);this.sources={};this.layers={};this.handlers['style.load']?.()}remove(){this.removed=true}getCanvas(){return{style:{}}}}
class MarkerStub{setLngLat(){return this}addTo(){return this}remove(){}}
const ctx=vm.createContext({console,URL,document:{getElementById:node,createElement:()=>({textContent:'',className:'',children:[],append(...c){this.children.push(...c)},addEventListener(){}})},
 maplibregl:{Map:MapStub,Marker:MarkerStub,NavigationControl:class{},setWorkerUrl(){}},chrome:{runtime:{getURL:p=>'chrome-extension://test/'+p,sendMessage:async()=>({ok:true})},storage:{local:{get:async()=>saved},onChanged:{addListener(){}}}}});
for(const p of ['model.js','map-model.js','map.js'])vm.runInContext(fs.readFileSync(p,'utf8'),ctx);
(async()=>{await new Promise(setImmediate);
 assert.equal(maps.length,1);assert.equal(typeof maps[0].styles[0],'object','start with local style, no provider request');
 assert.match(node('coverage').textContent,/1/);
 vm.runInContext('toggleBasemap()',ctx);assert.equal(maps[0].styles.at(-1),'https://tiles.openfreemap.org/styles/liberty');
 saved={...saved,accountKey:'b',snapshot:{...saved.snapshot,accountKey:'b'}};await ctx.loadMapState();
 assert.equal(maps[0].removed,true);assert.equal(typeof maps.at(-1).styles.at(-1),'object','account change revokes provider consent');
 saved={...saved,snapshot:null,error:'Session expired'};await ctx.loadMapState();assert.equal(maps.at(-1).removed,true);assert.equal(node('spaces').children.length,0,'failed auth removes account data');assert.equal(node('basemap').disabled,true);assert.equal(node('property').children.length,0,'failed auth clears building names');assert.equal(node('property').disabled,true);
 saved={...saved,accountKey:'b',snapshot:{accountKey:'a',properties:[]}};await ctx.loadMapState();assert.match(node('status').textContent,/verified|account|Refresh|expired/i);
 console.log('All map page tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
