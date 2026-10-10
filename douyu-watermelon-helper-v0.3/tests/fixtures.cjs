const radii=[19,31,41,45,57,69,73,98,117,124,129];
const fruit=(id,level,x,y,dropped=true)=>({id,level,kind:'normal',x,y,radius:radii[level-1],dropped,merging:false,vx:0,vy:0,omega:0,age:2});
function state(fruits=[],level=2){return {found:true,visible:true,playing:true,gameOver:false,ready:true,pendingDrop:false,merging:false,blocking:null,toolMode:'none',toolBusy:false,round:7,dropCount:0,score:0,currentFruitId:1,droppingFruitId:null,radii:[...radii],layout:{width:532,floor:-360,danger:320,top:340,dropY:340+radii[level-1],visibleWidth:750,visibleHeight:854},fruits:[fruit(1,level,0,340+radii[level-1],false),...fruits],updatedAt:Date.now()};}
function random(seed){let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
module.exports={radii,fruit,state,random};
