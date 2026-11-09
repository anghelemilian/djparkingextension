'use strict';
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=escapeHtml;
const distance=n=>n==null?'Distance unknown':Math.round(n)+' m away';
let state={},busy=false,verifiedThisOpen=false,connectionError=null;
async function load(){state=await chrome.storage.local.get(['snapshot','history','error','propertyId','radius','interval','watches']);render()}
function render(){
 if(!verifiedThisOpen){$('status').textContent='Verifying signed-in account…';$('content').textContent='';return;}
 const snapshot=connectionError?null:state.snapshot;
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
 if(connectionError||state.error)html+='<div class="error">'+safe(connectionError||state.error)+'</div>';
 if(snapshot?.warnings?.length)html+='<div class="error">'+snapshot.warnings.map(safe).join(' · ')+'</div>';
 if(!snapshot){
  $('content').innerHTML=html+'<section class="card"><h2>Connect your session</h2>Sign in to the <a href="https://parcari-ticketing.primariacraiova.ro/" target="_blank">parking portal</a>, leave its tab open, then press Refresh.</section>';
  return;
 }
 const model=ParkingModel.summarize(snapshot,propertyId,state.watches||[]);
 if(!model.property){$('content').innerHTML=html+'<div class="card">No active property linked to this account.</div>';return}
 const registrationLabel=lot=>lot.registrationState==='closed'?'Registration/selection closed (portal waitlist state)':lot.registrationState==='eligible'?'Portal reports this account can apply':'Registration/selection status unknown; eligibility not confirmed';
 const auctionLabel=lot=>lot.auctionState==='ended'||(Number.isFinite(lot.auctionEnd)&&lot.auctionEnd<=Date.now())?'Auction ended':lot.auctionState==='public'?'Public auction; timing must be checked':'Auction status unknown / no auction returned';
 const allocationLabel=spot=>spot.allocation==='unallocated'?'Unallocated (portal report)':'Allocation unknown';
 const countLabel=spot=>!Number.isInteger(spot.count)?'Registrations unknown':
  (spot.auctionState==='ended'||spot.countKind==='historical'?'Historical: ':ParkingModel.currentDemand(spot)?'':'Reported, timing unverified: ')+spot.count+' registrations (auction '+spot.auctionId+')';
 html+='<section class="card"><h2>Building parking inventory</h2><div class="stats"><div class="stat"><small>Lots returned</small><b>'+model.property.lots.length+'</b></div><div class="stat"><small>Numbered spaces returned</small><b>'+model.spaces.length+'</b></div><div class="stat"><small>Current demand known</small><b>'+model.auctioned.length+'</b></div></div><p class="hint">Inventory is independent of applications and auctions. Missing results do not prove there are no spaces. Zero registrations never means free or allocated.</p></section>';
 if(Date.now()>=Date.parse('2026-11-09T00:00:00+02:00'))html+='<section class="card"><h2>Announced registration period ended</h2><p class="hint">The announced 19 October–8 November 2026 selection period has closed. Verification, allocation and possible auctions follow separately. This dated notice does not establish the current state of every lot or future sessions. <a href="https://parcari.primariacraiova.ro/comunicate/" target="_blank">Municipality announcements</a></p></section>';
 if(model.auctioned.length){
  html+='<section class="card"><h2>Current reported registration demand</h2><p>'+model.zero+' with zero registrations · '+model.multiple+' with 2+ registrations</p><p class="hint">Only identified public, unended auctions outside an explicitly closed state are included. Registration and bidding are separate; counts do not prove that either is open, or that a space is unallocated.</p></section>';
 }else html+='<section class="card"><h2>Current registration demand unavailable</h2><p class="hint">No verified current demand counts. Closed, ended and unknown auction states do not hide the inventory below.</p></section>';
 html+='<section class="card"><h2>My open applications</h2>'+(model.own.length?model.own.map(t=>'<div class="entry"><strong>'+safe(t.space?.lotName||t.lotId)+' · #'+safe(t.space?.number||t.spotId)+'</strong><p class="hint">'+safe(t.space?countLabel(t.space):'Space inventory unavailable')+' · Requested regime: '+safe(t.regime||'not specified')+'</p></div>').join(''):'<p class="hint">'+(model.ticketStatus==='ok'?'No open auction ticket returned for this building. Closed applications and allocations are not established by this.':'Ticket lookup incomplete. Application status unknown; inventory remains available.')+'</p>')+'</section>';
 if(model.alerts.length)html+='<section class="card alert"><h2>Competition detected</h2><p>'+model.alerts.map(s=>safe(s.lotName)+' #'+safe(s.number)+' has '+s.count+' registrations').join('; ')+'</p></section>';
 if(model.alternatives.length)html+='<section class="card"><h2>Zero-registration candidates</h2><p class="hint">Not verified vacancies. Check dates, regime and eligibility in the portal.</p>'+model.alternatives.map(s=>'<div class="entry">'+safe(s.lotName)+' · #'+safe(s.number)+' · '+safe(distance(s.distance))+'</div>').join('')+'</section>';
 html+='<section class="card"><h2>Nearby parking spaces</h2><p class="hint">Colors show current registration demand only: green 0, blue 1, red 2+. Grey means unknown or historical demand. Allocation is listed separately. Star: watched. Click any numbered space to watch/unwatch.</p>';
 if(model.property.inventoryStatus==='unknown')html+='<p>Parking-lot inventory unavailable. The linked building is verified, but no lot count can be confirmed.</p>';
 else if(!model.property.lots.length)html+='<p>No parking lots returned within this radius. This does not establish availability; try another radius or check the official portal.</p>';
 for(const lot of model.property.lots){
  html+='<div class="lot"><div class="lothead"><strong>'+safe(lot.name)+'</strong><span>'+safe(distance(lot.distance))+'</span></div><p class="hint">'+safe(registrationLabel(lot))+' · '+safe(auctionLabel(lot))+'</p>';
  if(lot.inventoryStatus==='unknown')html+='<p>Numbered-space inventory unavailable: response missing or malformed.</p>';
  else if(!lot.spots.length)html+='<p>No numbered spaces returned for this lot. Allocation remains unknown.</p>';
  html+='<div class="grid">';
  for(const spot of [...lot.spots].sort((a,b)=>String(a.number).localeCompare(String(b.number),undefined,{numeric:true}))){
   const normalized=model.spaces.find(s=>s.id===spot.id&&s.lotId===lot.id)||spot;
   const mine=model.own.some(t=>String(t.spotId)===String(spot.id)&&String(t.lotId)===String(lot.id));
   const watched=(state.watches||[]).some(w=>String(w.propertyId)===String(propertyId)&&String(w.lotId)===String(lot.id)&&String(w.spotId)===String(spot.id));
   const kind=!ParkingModel.currentDemand(normalized)?'':spot.count===0?'zero':spot.count===1?'one':'multi';
   const label='Space #'+spot.number+'; '+allocationLabel(spot)+'; '+countLabel(normalized)+'; '+(spot.type||'type unknown');
   html+='<button type="button" class="spot '+kind+(mine?' mine':'')+(watched?' watched':'')+'" data-property="'+safe(propertyId)+'" data-lot="'+safe(lot.id)+'" data-spot="'+safe(spot.id)+'" aria-pressed="'+watched+'" aria-label="'+safe(label)+'" title="'+safe('Click to '+(watched?'unwatch: ':'watch: ')+label)+'">'+safe(spot.number)+(watched?'★':'')+'</button>';
  }
  html+='</div>';
  for(const spot of lot.spots){
   const normalized=model.spaces.find(s=>s.id===spot.id&&s.lotId===lot.id)||spot;
   html+='<p class="hint">#'+safe(spot.number)+' · '+safe(allocationLabel(spot))+' · '+safe(countLabel(normalized))+'</p>';
  }
  html+='</div>';
 }
 html+='</section>';
 const history=(state.history||[]).filter(c=>c.auctionId&&String(c.propertyId)===String(propertyId)).slice(0,8);
 if(history.length)html+='<section class="card"><h2>Historical observed count changes</h2><p class="hint">Past observations, not current availability.</p>'+history.map(c=>'<div class="entry"><b>'+safe(c.lot)+' #'+safe(c.space)+'</b> '+safe(c.old)+' → '+safe(c.count)+' <p class="hint">Auction '+safe(c.auctionId)+' · '+safe(new Date(c.at).toLocaleString())+'</p></div>').join('')+'</section>';
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
 try{const result=await chrome.runtime.sendMessage({type:'refresh'});if(!result?.ok)throw Error(result?.error||'Account refresh failed');connectionError=null;verifiedThisOpen=true;await load()}catch(e){connectionError=e.message;verifiedThisOpen=true;state={...state,snapshot:null}}finally{busy=false;$('refresh').disabled=false;render()}
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
