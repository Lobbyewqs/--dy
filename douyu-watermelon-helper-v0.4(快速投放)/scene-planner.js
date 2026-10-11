(function (root) {
  'use strict';
  const model = typeof module !== 'undefined' && module.exports ? require('./physics-model.js') : root.WatermelonPhysicsModel;
  const baseline = typeof module !== 'undefined' && module.exports ? require('./greedy-baseline.js') : root.WatermelonGreedyBaseline;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const mergeable=model.mergeable;
  const validFruit=f=>f && Number.isInteger(f.level) && f.level>=1 && f.level<=11 &&
    ['x','y','radius'].every(k=>Number.isFinite(f[k])) && f.radius>0 &&
    ['vx','vy','omega'].every(k=>f[k]===undefined || Number.isFinite(f[k]));
  function validState(s) {
    const physics=s?.physics;
    if(physics && (['gravity','friction','restitution','linearDamping','angularDamping','mergeSlop'].some(k=>physics[k]!==undefined && (!Number.isFinite(physics[k]) || physics[k]<0)) ||
      (physics.explosionPowers!=null && (!Array.isArray(physics.explosionPowers) || physics.explosionPowers.length!==11 || !physics.explosionPowers.every(v=>Number.isFinite(v)&&v>=0&&v<=100)))))return false;
    return Boolean(s?.found && s.playing && !s.gameOver && s.layout &&
      ['width','floor','danger','top'].every(k=>Number.isFinite(s.layout[k])) && s.layout.width>0 &&
      s.layout.danger>s.layout.floor && s.layout.top>=s.layout.danger && Array.isArray(s.fruits) &&
      s.fruits.length<=180 && s.fruits.every(validFruit) && Array.isArray(s.radii) && s.radii.length===11 &&
      s.radii.every(r=>Number.isFinite(r)&&r>0));
  }
  function landing(s,x,current,fruits) {
    let y=s.layout.floor+current.radius,hit=null;
    for(const f of fruits){const dx=Math.abs(x-f.x),sum=current.radius+f.radius;if(dx>=sum)continue;
      const contact=f.y+Math.sqrt(Math.max(0,sum*sum-dx*dx));if(contact>y){y=contact;hit=f;}}
    return {y,hit};
  }
  function candidates(s,level,limit=40) {
    const radius=s.radii[level-1],left=-s.layout.width/2+radius+1,right=s.layout.width/2-radius-1;
    if(left>=right)return [];
    const fruits=s.fruits.filter(f=>f.dropped&&!f.merging),current={radius,level,kind:'normal'};
    const xs=Array.from({length:17},(_,i)=>left+(right-left)*i/16);
    xs.push(clamp(0,left,right));
    for(const f of fruits){xs.push(clamp(f.x,left,right));
      for(const sign of [-1,1])xs.push(clamp(f.x+sign*(f.radius+radius+2),left,right));}
    const sorted=[...fruits].sort((a,b)=>a.x-b.x);
    for(let i=1;i<sorted.length;i++)xs.push(clamp((sorted[i-1].x+sorted[i].x)/2,left,right));
    const list=[...new Set(xs.map(x=>Math.round(x*10)/10))].filter(x=>x>=left&&x<=right).map(x=>{
      const impact=landing(s,x,current,fruits);
      const alignment=impact.hit ? 1-Math.abs(x-impact.hit.x)/(radius+impact.hit.radius) : 0;
      const direct=impact.hit && mergeable(current,impact.hit);
      return {x,y:impact.y,priority:(direct?140+level*8+alignment*12:0)-(impact.y+radius-s.layout.floor)/(s.layout.danger-s.layout.floor)*80};
    });
    list.sort((a,b)=>b.priority-a.priority || Math.abs(a.x)-Math.abs(b.x) || a.x-b.x);
    // 保留横向分散的候选，防止目标中心挤掉另一侧的空位。
    const selected=[], add=c=>{if(c&&!selected.some(a=>Math.abs(a.x-c.x)<1))selected.push(c);};
    for(let i=0;i<Math.min(8,limit);i++)add(list[i]);
    for(let bin=0;bin<8;bin++)add(list.find(c=>Math.floor((c.x-left)/(right-left+0.001)*8)===bin));
    for(const c of list){if(selected.length>=limit)break;add(c);}
    return selected.slice(0,limit);
  }
  function health(s,fruits) {
    if(!fruits.length)return {value:0,maxHeight:0,roughness:0,risk:0,buried:0};
    const h=s.layout.danger-s.layout.floor,w=s.layout.width,base=s.layout.floor;
    let maxHeight=0,weightedY=0,mass=0,risk=0,buried=0,readiness=0;
    for(const f of fruits){const top=(f.y+f.radius-base)/h,m=f.radius*f.radius;
      maxHeight=Math.max(maxHeight,top);weightedY+=m*(f.y-base)/h;mass+=m;
      risk+=Math.max(0,(top-0.65)/0.35)**3;
      if(f.level<7){const probe={radius:f.radius,level:f.level,kind:f.kind};
        const impact=landing(s,f.x,probe,fruits.filter(a=>a.id!==f.id));
        if(impact.hit && impact.y>f.y+f.radius*1.1 && impact.hit.level>f.level)buried+=(7-f.level)/7;}
    }
    const profile=Array.from({length:25},(_,i)=>{
      const x=-w/2+w*(i+0.5)/25;
      return Math.max(base,...fruits.filter(f=>Math.abs(f.x-x)<f.radius).map(f=>f.y+Math.sqrt(Math.max(0,f.radius*f.radius-(x-f.x)**2))));
    }).map(y=>(y-base)/h);
    const mean=profile.reduce((a,b)=>a+b,0)/profile.length;
    const roughness=profile.slice(1).reduce((sum,v,i)=>sum+Math.abs(v-profile[i]),0)/(profile.length-1);
    for(let i=0;i<fruits.length;i++){
      const a=fruits[i];if(a.level===11)continue;
      let closest=0;
      for(let j=i+1;j<fruits.length;j++){const b=fruits[j];if(!mergeable(a,b))continue;
        const gap=Math.max(0,Math.hypot(a.x-b.x,a.y-b.y)-a.radius-b.radius);
        closest=Math.max(closest,Math.max(0,1-gap/(a.radius+b.radius))*Math.min(2.5,a.level/2));}
      readiness+=closest;
    }
    const value=-145*maxHeight*maxHeight-80*mean-25*weightedY/Math.max(mass,1)-220*risk-45*roughness-5*buried+9*readiness;
    return {value,maxHeight,mean,roughness,risk,buried,readiness};
  }
  function evaluate(s,result) {
    if(!result)return -1e9;
    return health(s,result.fruits).value + result.gain - (result.dead ? 100000 : 0) - (result.safe ? 0 : 1200) - (result.settled ? 0 : 24);
  }
  function eligible(s) {
    return validState(s) && s.visible && s.ready && !s.pendingDrop && !s.merging &&
      !s.blocking && !s.toolBusy && (!s.toolMode || s.toolMode==='none');
  }
  function releaseDelay(s,x) {
    const current=s.fruits.find(f=>f.id===s.currentFruitId);
    return Math.min(0.22,Math.max(0.12,Math.abs(x-(current?.x||0))/1200));
  }
  function projected(s,seconds) {
    return {...s,fruits:s.fruits.map(f=>!f.dropped?{...f}:{...f,
      x:clamp(f.x+(f.vx||0)*32*seconds,-s.layout.width/2+f.radius,s.layout.width/2-f.radius),
      y:Math.max(s.layout.floor+f.radius,f.y+(f.vy||0)*32*seconds)})};
  }
  function geometry(s,current,x) {
    let impact=landing(s,x,current,s.fruits.filter(f=>f.dropped&&!f.merging));
    let flight=0;
    // 两次局部修正即可；这里只外推短期速度，不猜数秒后的连锁。
    for(let i=0;i<2;i++){
      const distance=Math.max(0,s.layout.dropY-impact.y);
      flight=Math.sqrt(2*distance/(s.physics?.gravity||1300));
      impact=landing(projected(s,Math.min(0.45,releaseDelay(s,x)+flight)),x,current,
        projected(s,Math.min(0.45,releaseDelay(s,x)+flight)).fruits.filter(f=>f.dropped&&!f.merging));
    }
    const hit=impact.hit, alignment=hit?1-Math.abs(x-hit.x)/(current.radius+hit.radius):0;
    const merge=Boolean(hit&&mergeable(current,hit)&&alignment>0.35);
    const top=merge?Math.max(s.layout.floor+s.radii[current.level],hit.y)+s.radii[current.level]:impact.y+current.radius;
    const h=s.layout.danger-s.layout.floor;
    const motion=hit?Math.hypot(hit.vx||0,hit.vy||0):0;
    return {x,y:impact.y,hitId:hit?.id??null,merge,flight,top,
      safe:top<s.layout.danger-Math.max(10,current.radius*0.2),
      score:(merge?90+current.level*5+alignment*20:0)-110*((top-s.layout.floor)/h)**2-
        Math.min(24,motion*3)-Math.abs(x)/s.layout.width};
  }
  function guard(s) {
    return {at:s.updatedAt??Date.now(),maxAgeMs:400,fruits:s.fruits.filter(f=>f.dropped&&!f.merging)
      .map(f=>({id:f.id,x:f.x,y:f.y,vx:f.vx||0,vy:f.vy||0}))};
  }
  function compatible(a,b) {
    if(!eligible(b)||a.round!==b.round||a.currentFruitId!==b.currentFruitId)return false;
    const dt=((b.updatedAt??Date.now())-(a.updatedAt??Date.now()))/1000;
    if(dt<0||dt>0.4)return false;
    const old=a.fruits.filter(f=>f.dropped&&!f.merging),live=b.fruits.filter(f=>f.dropped&&!f.merging);
    if(old.length!==live.length)return false;
    const tolerance=3+0.5*(b.physics?.gravity||1300)*dt*dt;
    return old.every(f=>{const n=live.find(n=>n.id===f.id&&n.level===f.level);
      return n&&Math.hypot(n.x-f.x-(f.vx||0)*32*dt,n.y-f.y-(f.vy||0)*32*dt)<=tolerance;});
  }
  function* search(s,options={}) {
    if(!eligible(s))return null;
    const current=s.fruits.find(f=>f.id===s.currentFruitId&&!f.dropped&&!f.merging);
    if(!current||current.kind!=='normal')return null;
    const start=performance.now(),budget=options.budgetMs??140;
    const trust=clamp(options.modelTrust??0.65,0.15,0.8);
    const old=baseline.plan(s), xs=candidates(s,current.level,20).map(c=>c.x);
    if(old)xs.push(old.x);
    const choices=[...new Set(xs)].map(x=>geometry(s,current,x)).filter(c=>c.safe)
      .sort((a,b)=>b.score-a.score||Math.abs(a.x)-Math.abs(b.x));
    if(!choices.length)return null;
    const rejected=new Set();let unsafe=0;
    const fallback=()=>{const choice=choices.find(c=>!rejected.has(c.x));return choice?({...choice,safe:true,chain:choice.merge?1:0,level:current.level,
      fruitId:current.id,round:s.round,method:'reactive-geometry',diagnostics:{
        elapsedMs:Math.round(performance.now()-start),simulations,timeouts,modelTrust:trust,
        depth:1,fallback:true,reason:'短期模型未能完成，使用保守几何落点'}}):null;};
    let simulations=0,timeouts=0;
    if(options.mode==='greedy'||budget<=0)return fallback();
    const evaluated=[];
    for(const c of choices.slice(0,6)){
      if(performance.now()-start>budget*0.6&&evaluated.length>=2)break;
      if(options.isCancelled?.())return null;
      const delay=releaseDelay(s,c.x)+(options.transportMs??15)/1000+(Date.now()-(s.updatedAt??Date.now()))/1000;
      const seconds=Math.min(2,Math.max(1,delay+c.flight+0.45));
      const result=model.simulate(s,current.level,c.x,{releaseDelay:delay,seconds,afterContact:0.32,
        continuous:true,accurate:true,maxMs:18,capture:true});simulations++;
      if(!result||result.truncated){timeouts++;yield;continue;}
      if(!result.firstContact||!result.safe){if(result.firstContact&&!result.safe){rejected.add(c.x);unsafe++;}yield;continue;}
      const reliableMerge=result.firstContact.merge&&result.chain>0;
      const score=c.score*(1-trust)+(health(s,result.fruits).value+Math.min(1,result.chain)*(90+current.level*6))*trust;
      evaluated.push({...c,result,score,merge:reliableMerge,chain:reliableMerge?1:0});
      yield;
    }
    evaluated.sort((a,b)=>b.score-a.score);
    const finalists=[];
    for(const c of evaluated.slice(0,2)){
      if(options.isCancelled?.())return null;
      if(performance.now()-start>budget)break;
      // 同时扰动落点、摩擦和弹性，拒绝只在单一模型里成立的脆弱结果。
      const shift=Math.max(3,s.layout.width*0.008);let robust=true,agrees=c.merge,uncertainty=0;
      for(const sign of [-1,1]){
        if(options.isCancelled?.())return null;
        if(performance.now()-start>budget){robust=false;break;}
        const altered={...s,physics:{...s.physics,friction:(s.physics?.friction??0.2)*(sign<0?0.8:1.25),
          restitution:Math.max(0,(s.physics?.restitution??0.1)+sign*0.03)}};
        const result=model.simulate(altered,current.level,clamp(c.x+sign*shift,
          -s.layout.width/2+current.radius,s.layout.width/2-current.radius),{
          releaseDelay:c.result.releaseDelay+0.04,seconds:Math.min(2,c.result.releaseDelay+c.flight+0.6),
          afterContact:0.32,continuous:true,accurate:true,maxMs:18});simulations++;
        if(result?.truncated)timeouts++;
        if(!result?.safe||!result.firstContact){robust=false;if(result&&!result.truncated&&!result.safe)rejected.add(c.x);}
        else{
          const mergeAgrees=result.chain>0&&result.firstContact.merge&&result.firstContact.id===c.result.firstContact.id;
          agrees=agrees&&mergeAgrees;
          uncertainty=Math.max(uncertainty,Math.abs(result.maxTop-c.result.maxTop)+(!mergeAgrees&&c.merge?60:0));
        }
        yield;
      }
      if(robust)finalists.push({...c,score:c.score-uncertainty*0.7,merge:agrees,chain:agrees?1:0,uncertainty});
    }
    const best=finalists.sort((a,b)=>b.score-a.score)[0];
    if(!best)return unsafe>0&&unsafe===simulations-timeouts?null:fallback();
    return {x:best.x,y:best.result.firstContact.y,safe:true,score:best.score,merge:best.merge,chain:best.chain,
      level:current.level,fruitId:current.id,round:s.round,hitId:best.result.firstContact.id,
      method:'reactive-short-physics',prediction:{at:s.updatedAt??Date.now(),trace:best.result.trace,
        forecast:best.result.forecast,firstContact:best.result.firstContact},diagnostics:{
        simulations,timeouts,elapsedMs:Math.round(performance.now()-start),depth:1,modelTrust:trust,
        uncertainty:best.uncertainty,releaseDelay:best.result.releaseDelay,horizon:best.result.simulatedSeconds,
        continuous:true,fallback:false}};
  }
  function plan(s,options={}){const it=search(s,options);let next;do{next=it.next();}while(!next.done);return next.value;}
  async function planAsync(s,options={}){const it=search(s,options);let next;
    do{next=it.next();if(!next.done)await new Promise(resolve=>setTimeout(resolve,0));}while(!next.done);return next.value;}
  // 仅用于旧模式对照和诊断，默认投放不再等待此条件。
  const stable=baseline.stable;
  const api={plan,planAsync,stable,validState,eligible,compatible,guard,releaseDelay,geometry,
    projected,landing,mergeable,candidates,health,evaluate};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.WatermelonScenePlanner=api;
})(typeof globalThis!=='undefined'?globalThis:this);
