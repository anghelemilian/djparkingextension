'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=escapeHtml;
const distance=n=>n==null?'Distance unknown':Math.round(n)+' m away';
let state={},busy=false,verifiedThisOpen=false;
async function load(){state=await chrome.storage.local.get(['snapshot','history','error','propertyId','radius','interval','watches']);render()}
function render(){
 if(!verifiedThisOpen){$('status').textContent='Verifying signed-in account…';$('content').textContent='';return;}
 const {snapshot}=state;
 $('interval').value=String(state.interval||1);
 $('radius').value=String(state.radius||30);
 const props=snapshot?.properties||[];
 $('property').innerHTML=props.length?props.map(p=>'<option value="'+safe(p.id)+'">'+safe(p.name)+' ('+safe(p.id)+')</option>').join('') :'<option value="">No verified property</option>';
 let propertyId=state.propertyId??null;
 if(props.length&&!props.some(p=>String(p.id)===String(propertyId)))propertyId=props[0].id;
 $('property').disabled=!props.length;
 if(propertyId!==null)$('property').value=String(propertyId);
 $('status').textContent=snapshot?'Updated '+new Date(snapshot.at).toLocaleString()+(busy?' · refreshing':''):'Not connected'+(busy?' · refreshing':'');
 let html='';
 if(state.error)html+='<div class="error">'+safe(state.error)+'</div>';
 if(snapshot?.warnings?.length)html+='<div class="error">'+snapshot.warnings.map(safe).join(' · ')+'</div>';
 if(!snapshot){
  $('content').innerHTML=html+'<section class="card"><h2>Connect your session</h2>Sign in to the <a href="https://parcari-ticketing.primariacraiova.ro/" target="_blank">parking portal</a>, leave its tab open, then press Refresh.</section>';
  return;
 }
 const model=ParkingModel.summarize(snapshot,propertyId,state.watches||[]);
 if(!model.property){$('content').innerHTML=html+'<div class="card">No active property linked to this account.</div>';return}
 const percent=model.auctioned.length?Math.round(model.registered/model.auctioned.length*1000)/10:0;
 html+='<section class="card"><h2>Auction registration overview</h2><div class="stats"><div class="stat"><small>Total spaces</small><b>'+model.spaces.length+'</b></div><div class="stat"><small>Zero registrations</small><b>'+model.zero+'</b></div><div class="stat"><small>2+ registrations</small><b>'+model.multiple+'</b></div></div><p class="hint">'+model.registered+'/'+model.auctioned.length+' auction spaces registered ('+percent+'%). This is not physical occupancy.</p></section>';
 html+='<section class="card"><h2>'+ (model.mode==='monitoring'?'Monitoring mode':model.mode==='discovery'?'Discovery mode':'Registration status unknown') +'</h2><p class="hint">'+(model.mode==='monitoring'?'Your open applications are monitored automatically. You can also watch additional spaces.':model.mode==='discovery'?'No open auction registrations found. Explore zero-registration candidates or watch any space.':'Ticket lookup was incomplete. Existing results may be partial; this does not mean you have no registration.')+'</p></section>';
 html+='<section class="card"><h2>My applications</h2>'+(model.own.length?model.own.map(t=>'<div class="entry"><strong>'+safe(t.space?.lotName||t.lotId)+' · #'+safe(t.space?.number||t.spotId)+'</strong><span class="pill">'+safe(t.space?.count??'Unknown')+' registrations</span><p class="hint">Requested regime: '+safe(t.regime||'not specified')+'</p></div>').join('') :'<p class="hint">'+(model.ticketStatus==='ok'?'No open auction ticket for this property.':'Unable to confirm applications until ticket lookup succeeds.')+'</p>')+'</section>';
 if(model.alerts.length || model.mode!=='monitoring'){
  html+='<section class="card '+(model.alerts.length?'alert':'')+'"><h2>'+(model.alerts.length?'Competition detected':'Zero-registration candidates')+'</h2>'+(model.alerts.length?'<p>'+model.alerts.map(s=>safe(s.lotName)+' #'+safe(s.number)+' has '+s.count+' registrations').join('; ')+'</p>':'')+'<h3>Zero-registration alternatives ('+model.alternatives.length+')</h3><p class="hint">Same lot first, then nearby lots. Active normal spaces in public auctions only. Check auction dates, regime and eligibility before applying.</p>';
  html+=model.alternatives.length?model.alternatives.map(s=>'<div class="entry"><b>'+safe(s.lotName)+' · #'+safe(s.number)+'</b><span class="pill">0 registrations</span><p class="hint">'+safe(distance(s.distance))+' · '+safe(s.regime||'regime unknown')+'</p></div>').join(''):'<p>No qualifying alternatives within the selected radius.</p>';
  html+='</section>';
 }
 html+='<section class="card"><h2>Nearby parking spaces</h2><p class="hint">Green: 0 · Blue: 1 · Red: 2+ · Grey: not public auction. Outlined: your application. Star: manually watched. Click any space to watch/unwatch.</p>';
 for(const lot of model.property.lots){
  html+='<div class="lot"><div class="lothead"><strong>'+safe(lot.name)+'</strong><span>'+safe(distance(lot.distance))+'</span></div><div class="grid">';
  for(const spot of [...lot.spots].sort((a,b)=>String(a.number).localeCompare(String(b.number),undefined,{numeric:true}))){
   const mine=model.own.some(t=>String(t.spotId)===String(spot.id));
   const watched=(state.watches||[]).some(w=>String(w.propertyId)===String(propertyId)&&String(w.lotId)===String(lot.id)&&String(w.spotId)===String(spot.id));
   const kind=!spot.publicAuction||spot.count==null?'':spot.count===0?'zero':spot.count===1?'one':'multi';
   html+='<button type="button" class="spot '+kind+(mine?' mine':'')+(watched?' watched':'')+'" data-property="'+safe(propertyId)+'" data-lot="'+safe(lot.id)+'" data-spot="'+safe(spot.id)+'" aria-pressed="'+watched+'" title="'+safe('Click to '+(watched?'unwatch':'watch')+' space #'+spot.number+'; '+(spot.count??'unknown')+' registrations; '+(spot.type||'unknown'))+'">'+safe(spot.number)+(watched?'★':'')+'</button>';
  }
  html+='</div></div>';
 }
 html+='</section>';
 const history=(state.history||[]).filter(c=>String(c.propertyId)===String(propertyId)).slice(0,8);
 if(history.length)html+='<section class="card"><h2>Recent count changes</h2>'+history.map(c=>'<div class="entry"><b>'+safe(c.lot)+' #'+safe(c.space)+'</b> '+safe(c.old)+' → '+safe(c.count)+' <p class="hint">'+new Date(c.at).toLocaleString()+'</p></div>').join('')+'</section>';
 $('content').innerHTML=html;
 $('content').querySelectorAll('button[data-spot]').forEach(button=>button.addEventListener('click',async()=>{
  button.disabled=true;
  const res=await chrome.runtime.sendMessage({type:'watch',propertyId:Number(button.dataset.property),lotId:Number(button.dataset.lot),spotId:Number(button.dataset.spot),enabled:button.getAttribute('aria-pressed')!=='true'});
  if(!res?.ok)$('status').textContent=res?.error||'Watch change failed';
  await load();
 }));
}
async function refresh(){
 if(busy)return;
 busy=true;$('refresh').disabled=true;render();
 try{await chrome.runtime.sendMessage({type:'refresh'});verifiedThisOpen=true;await load()}catch(e){$('status').textContent=e.message}finally{busy=false;$('refresh').disabled=false;render()}
}
async function configure(payload){
 try{await chrome.runtime.sendMessage({type:'config',...payload});await load()}catch(e){$('status').textContent=e.message}
}
$('refresh').addEventListener('click',refresh);
$('property').addEventListener('change',e=>configure({propertyId:Number(e.target.value)}));
$('interval').addEventListener('change',e=>configure({interval:Number(e.target.value)}));
$('radius').addEventListener('change',e=>configure({radius:Number(e.target.value)}));
chrome.storage.onChanged.addListener((_changes,area)=>{if(area==='local')load()});
refresh().finally(()=>{verifiedThisOpen=true;render()});
