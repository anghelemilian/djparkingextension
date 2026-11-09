'use strict';
globalThis.ParkingMapModel={
 build(snapshot,propertyId,watches=[],query='',scope='all') {
  const summary=ParkingModel.summarize(snapshot,propertyId,watches);
  const visible=ParkingModel.filterSpaces(summary,query,scope);
  const features=[];let mapped=0,missing=0;
  const add=(id,geometry,properties)=>{
   if(geometry&&['Polygon','MultiPolygon'].includes(geometry.type))features.push({type:'Feature',id,geometry,properties});
  };
  const property=summary.property;
  if(property){
   add('building/'+property.id,property.geometry,{kind:'building',label:property.name});
   for(const lot of property.lots||[])add('lot/'+lot.id,lot.geometry,{kind:'lot',label:lot.name});
   for(const spot of visible){
    const key=spot.lotId+'/'+spot.id;
    if(!spot.geometry){missing++;continue;}
    const scheduled=summary.upcoming.scheduled.some(r=>r.spotId===spot.id&&r.lotId===spot.lotId);
    const watched=summary.watched.some(w=>w.id===spot.id&&w.lotId===spot.lotId);
    add(key,spot.geometry,{kind:'space',label:'#'+spot.number,key,lotId:spot.lotId,spotId:spot.id,lotName:spot.lotName,scheduled,watched,
     color:scheduled?'#7044b5':ParkingModel.currentDemand(spot)?(spot.count===0?'#19744d':spot.count===1?'#31579f':'#b93623'):'#64748b'});
    mapped++;
   }
  }
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const visit=points=>{if(typeof points[0]==='number'){minX=Math.min(minX,points[0]);maxX=Math.max(maxX,points[0]);minY=Math.min(minY,points[1]);maxY=Math.max(maxY,points[1]);}else for(const point of points)visit(point);};
  for(const feature of features)visit(feature.geometry.coordinates);
  return {collection:{type:'FeatureCollection',features},mapped,missing,total:visible.length,
   bounds:Number.isFinite(minX)?[[minX,minY],[maxX,maxY]]:null};
 }
};
