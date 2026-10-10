const fs=require('node:fs');
const old=require('./baseline-v02.js');
const next=require('../scene-planner.js');
const model=require('../physics-model.js');
const {state,fruit,random}=require('./fixtures.cjs');
const limit=Number(process.argv[2]||100),seeds=(process.argv[3]||'17,41,73,109').split(',').map(Number);
const results=[];
function play(planner,seed,perturbed){
  const draw=random(seed),jitter=random(seed^0xa543e2f),s=state();let gain=0,drops=0,highest=0,elapsed=0,maxHeight=0;const observed=[];
  for(let turn=0;turn<limit;turn++){
    const level=1+Math.floor(draw()*(turn<16?3:5));
    const id=Math.max(0,...s.fruits.map(f=>f.id))+1;
    s.currentFruitId=id;s.fruits=s.fruits.filter(f=>f.dropped);s.fruits.push(fruit(id,level,0,s.layout.top+s.radii[level-1],false));s.layout.dropY=s.layout.top+s.radii[level-1];
    observed.push(level);if(observed.length>24)observed.shift();const prior=[4,4,4,4,4];for(const l of observed)prior[l-1]++;
    const start=performance.now();const plan=planner.plan(s,{nextProbabilities:prior});elapsed+=performance.now()-start;
    if(!plan)break;
    const offset=(jitter()*2-1)*3.2;
    const environment=perturbed?{...s,physics:{friction:.28,restitution:.14,gravity:1270}}:s;
    const r=model.simulate(environment,level,plan.x+offset,{seconds:6,accurate:true,continuous:true,maxMs:Infinity});
    if(!r)break;gain+=r.gain;drops++;s.fruits=r.fruits.map(f=>({...f,line:undefined,age:2}));
    highest=Math.max(highest,...s.fruits.map(f=>f.level));maxHeight=(r.maxTop-s.layout.floor)/(s.layout.danger-s.layout.floor);
    if(r.dead||maxHeight>=1)break;
    if(planner===next && turn%20===19)console.log('progress',seed,perturbed?'holdout':'nominal',drops);
  }
  return {seed,environment:perturbed?'holdout':'nominal',drops,mergeCredit:gain,highest,finalHeight:Number(maxHeight.toFixed(3)),meanPlanMs:Math.round(elapsed/Math.max(drops,1))};
}
for(const seed of seeds){
  for(const perturbed of [false,true]){
    const a=play(old,seed,perturbed);console.log('v0.2',JSON.stringify(a));
    const b=play(next,seed,perturbed);console.log('v0.3',JSON.stringify(b));
    results.push({v02:a,v03:b});fs.writeFileSync(require('node:path').join(__dirname,'benchmark-results.json'),JSON.stringify({limit,results},null,2));
  }
}
const mean=key=>results.reduce((sum,r)=>sum+r[key].mergeCredit,0)/results.length;
console.log('SUMMARY',JSON.stringify({runs:results.length,limit,oldMean:mean('v02'),newMean:mean('v03'),creditGainPercent:(mean('v03')/mean('v02')-1)*100}));
