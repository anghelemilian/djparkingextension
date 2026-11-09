'use strict';
const $=id=>document.getElementById(id);
const LOCAL_STYLE={version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e8edf0'}}]};
let map=null,mapState={},view=null,markers=[],account=null,propertyId=null,verified=false,busy=false,basemapOn=false,needsFit=true,styleReady=false,loadGeneration=0;
maplibregl.setWorkerUrl(chrome.runtime.getURL('vendor/maplibre/maplibre-gl-csp-worker.js'));
function clearMap(message='Verifying account…',clearAccount=true) {
 if(clearAccount){$('property').replaceChildren();$('property').disabled=true;$('search').value='';$('scope').value='all';}
 if(map)map.remove();map=null;view=null;markers=[];basemapOn=false;needsFit=true;styleReady=false;
 $('map').replaceChildren();$('spaces').replaceChildren();$('selection').textContent='Select a numbered space on the map or in this list.';
 $('coverage').textContent='';$('status').textContent=message;$('basemap').disabled=true;$('fit').disabled=true;
 $('basemap').textContent='Enable OpenStreetMap background';
}
function selectSpace(key) {
 const feature=view?.collection.features.find(f=>f.properties.key===key);
 if(!feature)return;
 const p=feature.properties;
 $('selection').replaceChildren();
 const title=document.createElement('strong');title.textContent=p.lotName+' · '+p.label;
 const details=document.createElement('p');details.textContent=(p.scheduled?'Scheduled auction item. ':'')+'Allocation is not established by the map. '+(p.watched?'Watched.':'Not watched.');
 const watch=document.createElement('button');watch.textContent=p.watched?'Unwatch space':'Watch space';
 watch.addEventListener('click',async()=>{
  watch.disabled=true;
  try{
   const result=await chrome.runtime.sendMessage({type:'watch',propertyId,lotId:p.lotId,spotId:p.spotId,enabled:!p.watched});
   if(!result?.ok)throw Error(result?.error||'Watch change failed');
   await loadMapState();selectSpace(key);
  }catch(e){$('status').textContent=e.message;watch.disabled=false;}
 });
 $('selection').append(title,details,watch);
}
function drawMapData() {
 if(!map||!view||!styleReady)return;
 if(map.getSource('parking'))map.getSource('parking').setData(view.collection);
 else{
  map.addSource('parking',{type:'geojson',data:view.collection});
  map.addLayer({id:'parking-fill',type:'fill',source:'parking',paint:{'fill-color':['match',['get','kind'],'building','#31579f','lot','#5c9eac',['get','color']],'fill-opacity':['match',['get','kind'],'space',0.65,0.12]}});
  map.addLayer({id:'parking-line',type:'line',source:'parking',paint:{'line-color':['case',['==',['get','watched'],true],'#e19b23',['==',['get','scheduled'],true],'#7044b5','#486072'],'line-width':['case',['==',['get','watched'],true],3,1.5]}});
 }
 for(const marker of markers)marker.remove();markers=[];
 for(const f of view.collection.features.filter(f=>f.properties.kind==='space')){
  const points=f.geometry.coordinates.flat(f.geometry.type==='Polygon'?1:2);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const label=document.createElement('span');label.className='map-number'+(f.properties.scheduled?' scheduled':'');label.textContent=f.properties.label;
  markers.push(new maplibregl.Marker({element:label}).setLngLat([(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2]).addTo(map));
 }
 if(needsFit&&view.bounds){map.fitBounds(view.bounds,{padding:55,maxZoom:21,duration:0});needsFit=false;}
}
function renderMap() {
 if(!verified||!mapState.snapshot||mapState.snapshot.accountKey!==mapState.accountKey)return;
 view=ParkingMapModel.build(mapState.snapshot,propertyId,mapState.watches||[],$('search').value,$('scope').value||'all');
 $('coverage').textContent=view.mapped+' of '+view.total+' filtered spaces have map outlines. '+view.missing+' have missing or unusable geometry.';
 $('spaces').replaceChildren();$('selection').textContent='Select a numbered space on the map or in this list.';
 for(const f of view.collection.features.filter(f=>f.properties.kind==='space')){
  const button=document.createElement('button');button.className='space-row'+(f.properties.scheduled?' scheduled':'')+(f.properties.watched?' watched':'');
  button.textContent=f.properties.lotName+' · '+f.properties.label+(f.properties.scheduled?' · Scheduled':'')+(f.properties.watched?' ★':'');
  button.addEventListener('click',()=>selectSpace(f.properties.key));$('spaces').append(button);
 }
 $('fit').disabled=!view.bounds;$('basemap').disabled=!view.bounds;
 if(!view.bounds){
  const coverage=$('coverage').textContent;
  clearMap('No usable geometry returned for this building/filter. Refresh after updating the extension; locations are never guessed.',false);
  $('coverage').textContent=coverage;return;
 }
 if(!map){
  try{
   map=new maplibregl.Map({container:'map',style:LOCAL_STYLE,center:[0,0],zoom:1,attributionControl:{compact:false,customAttribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors · <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>'},
    transformRequest:url=>{
     const target=new URL(url,location.href);
     if(target.origin!==location.origin&&target.origin!=='https://tiles.openfreemap.org')throw Error('Unexpected map resource host');
     return {url:target.href,credentials:'omit'};
    }});
   map.addControl(new maplibregl.NavigationControl(),'top-left');
   styleReady=map.isStyleLoaded();
   map.on('style.load',()=>{styleReady=true;drawMapData();});
   map.on('click','parking-fill',event=>{const p=event.features?.find(f=>f.properties.kind==='space')?.properties;if(p)selectSpace(p.key);});
   map.on('error',()=>{
    if(basemapOn){basemapOn=false;$('basemap').textContent='Enable OpenStreetMap background';styleReady=false;map.setStyle(LOCAL_STYLE,{diff:false});$('status').textContent='Street background unavailable. Local parking outlines remain available.';}
   });
  }catch(e){clearMap('This browser could not initialize the map. WebGL is required.',false);return;}
 }
 drawMapData();
}
async function loadMapState() {
 const generation=++loadGeneration;
 const next=await chrome.storage.local.get(['snapshot','accountKey','propertyId','watches','error']);
 if(generation!==loadGeneration||!verified)return;
 if(!next.snapshot||next.snapshot.accountKey!==next.accountKey){mapState=next;account=null;clearMap(next.error||'Refresh to verify the signed-in account.');return;}
 if(account!==next.accountKey){clearMap();account=next.accountKey;propertyId=next.propertyId;$('search').value='';$('scope').value='all';}
 mapState=next;
 const properties=next.snapshot.properties||[];
 if(!properties.some(p=>p.id===propertyId))propertyId=properties[0]?.id??null;
 $('property').replaceChildren(...properties.map(p=>{const option=document.createElement('option');option.value=String(p.id);option.textContent=p.name;return option;}));
 $('property').value=propertyId==null?'':String(propertyId);$('property').disabled=!properties.length;
 $('status').textContent='Verified '+new Date(next.snapshot.at).toLocaleString()+(next.snapshot.warnings?.length?' · Some portal data unavailable; see popup warnings.':'');
 renderMap();
}
async function refreshMap() {
 if(busy)return;busy=true;verified=false;++loadGeneration;account=null;clearMap();$('refresh').disabled=true;
 try{const result=await chrome.runtime.sendMessage({type:'refresh'});if(!result?.ok)throw Error(result?.error||'Account verification failed');verified=true;await loadMapState();}
 catch(e){verified=false;clearMap(e.message);}
 finally{busy=false;$('refresh').disabled=false;}
}
function toggleBasemap() {
 if(!map||!view?.bounds||!verified)return;
 basemapOn=!basemapOn;$('basemap').textContent=basemapOn?'Disable street background':'Enable OpenStreetMap background';
 styleReady=false;map.setStyle(basemapOn?'https://tiles.openfreemap.org/styles/liberty':LOCAL_STYLE,{diff:false});
}
$('refresh').addEventListener('click',refreshMap);$('basemap').addEventListener('click',toggleBasemap);
$('fit').addEventListener('click',()=>{if(map&&view?.bounds)map.fitBounds(view.bounds,{padding:55,maxZoom:21});});
$('property').addEventListener('change',()=>{propertyId=Number($('property').value);needsFit=true;renderMap();});
$('search').addEventListener('input',renderMap);$('scope').addEventListener('change',renderMap);
chrome.storage.onChanged.addListener((_changes,area)=>{if(area==='local'&&verified)loadMapState().catch(()=>{verified=false;clearMap('Unable to verify local account data. Refresh to reconnect.');});});
refreshMap();
