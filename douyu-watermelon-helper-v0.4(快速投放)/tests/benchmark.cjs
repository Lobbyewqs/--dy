const fs=require('node:fs'),path=require('node:path');
const P=require('../scene-planner.js'),M=require('../physics-model.js'),NewController=require('../controller.js');
const OldController=require('./controller-v03.js'),OldP=require('./planner-v03.js');
const {state,fruit}=require('./fixtures.cjs');
async function cadence(Controller,isOld){
 const real=Date.now;let now=100000,lastDrop=now-10000,id=1,drops=0;
 Date.now=()=>now;
 const snapshot=()=>{const s=state([fruit(90,6,140,-291)]);s.updatedAt=now;s.currentFruitId=id;s.fruits[0].id=id;s.dropCount=drops;
  const moving=now-lastDrop<6000;s.droppingFruitId=moving?90:null;s.fruits[1].vx=moving?0.08:0;s.fruits[1].omega=moving?0.7:0;
  s.ready=now-lastDrop>=600;return s;};
 const planner={...P,stable:OldP.stable,planAsync:async s=>({x:0,fruitId:s.currentFruitId,round:s.round,safe:true,chain:0,diagnostics:{simulations:0,elapsedMs:0}})};
 const times=[];
 const c=new Controller({start:async()=>snapshot(),stop:async()=>{},read:async()=>({state:snapshot(),armed:true}),
  drop:async()=>{drops++;id++;lastDrop=now;times.push(now);return {accepted:true};}},planner);
 try{await c.start();for(now=100000;now<130000;now+=isOld?500:150)await c.tick();await c.stop();}
 finally{Date.now=real;}
 return {drops,intervalsMs:times.slice(1).map((t,i)=>t-times[i]),durationMs:30000};
}
async function main(){
 const timing=[];
 for(let i=0;i<12;i++){
  const s=state([fruit(2,6,-150,-291),fruit(3,3,70,-319),fruit(4,4,180,-315)],1+i%5);
  s.fruits[2].vx=(i%3-1)*0.2;s.fruits[1].omega=0.4;s.updatedAt=Date.now();
  let t=performance.now();const old=OldP.plan(s);const oldMs=performance.now()-t;
  s.updatedAt=Date.now();t=performance.now();const next=P.plan(s);const newMs=performance.now()-t;
  timing.push({fixture:i,oldMs:Math.round(oldMs),newMs:Math.round(newMs),newMethod:next?.method,oldMethod:old?.method});
 }
 const delays=[0.12,0.16,0.2,0.22],alignment=[];
 for(const delay of delays){
  const s=state(),seconds=0.45;
  const actual=M.simulate({...s,physics:{gravity:1330}},2,0,{releaseDelay:delay,seconds,maxMs:Infinity});
  const old=M.simulate(s,2,0,{seconds,maxMs:Infinity});
  const next=M.simulate(s,2,0,{releaseDelay:delay,seconds,maxMs:Infinity});
  alignment.push({delay,oldPositionError:Math.abs(old.fruits[0].y-actual.fruits[0].y),newPositionError:Math.abs(next.fruits[0].y-actual.fruits[0].y)});
 }
 const cadenceOld=await cadence(OldController,true),cadenceNew=await cadence(NewController,false);
 const average=(a,k)=>a.reduce((v,r)=>v+r[k],0)/a.length;
 const result={timing,alignment,cadenceOld,cadenceNew,summary:{oldMeanPlanMs:average(timing,'oldMs'),newMeanPlanMs:average(timing,'newMs'),
  fallbackCount:timing.filter(r=>r.newMethod==='reactive-geometry').length,
  oldMeanAlignmentError:average(alignment,'oldPositionError'),newMeanAlignmentError:average(alignment,'newPositionError')}};
 fs.writeFileSync(path.join(__dirname,'benchmark-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
