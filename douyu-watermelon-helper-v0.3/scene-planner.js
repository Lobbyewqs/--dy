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
  function distribution(weights) {
    const source=Array.isArray(weights)&&weights.length ? weights : [1,1,1,1,1];
    const list=source.slice(0,11).map((p,i)=>({level:i+1,p:Number.isFinite(p)&&p>0?p:0})).filter(a=>a.p>0);
    const sum=list.reduce((a,b)=>a+b.p,0);
    return sum ? list.map(a=>({...a,p:a.p/sum})) : distribution(null);
  }
  function* search(s,options={}) {
    if(!validState(s))return null;
    if(s.pendingDrop || s.merging || s.blocking || s.toolBusy || (s.toolMode && s.toolMode!=='none') ||
      s.fruits.some(f=>f.dropped && !f.merging && f.y+f.radius>s.layout.danger))return null;
    const current=s.fruits.find(f=>f.id===s.currentFruitId&&!f.dropped&&!f.merging);
    if(!current || current.kind!=='normal')return null;
    const start=performance.now(), budget=options.budgetMs ?? 900;
    const maxRoot=clamp(options.maxRoot ?? 24,9,64), beamWidth=clamp(options.beamWidth ?? 3,1,8), replyCount=clamp(options.replyCount ?? 4,2,10);
    const incumbent=baseline.plan(s);
    const roots=candidates(s,current.level,maxRoot), evaluated=[];
    if(incumbent){const old=roots.findIndex(c=>Math.abs(c.x-incumbent.x)<1);if(old>=0)roots.splice(old,1);roots.unshift({x:incumbent.x,y:incumbent.y,incumbent:true});}
    let simulations=0;
    let timeouts=0;
    const fallback=()=>incumbent ? {...incumbent,method:'greedy-fallback',diagnostics:{simulations,rootCandidates:evaluated.length,depth:0,nextCoverage:0,timeouts,elapsedMs:Math.round(performance.now()-start),fallback:true}} : null;
    const elapsed=()=>performance.now()-start;
    for(const c of roots){
      if(evaluated.length>=9 && elapsed()>budget*0.42)break;
      if(options.isCancelled?.())return null;
      const result=model.simulate(s,current.level,c.x);simulations++;
      if(result?.truncated)timeouts++;
      if(result)evaluated.push({...c,result,score:evaluate(s,result)});
      yield;
    }
    evaluated.sort((a,b)=>b.score-a.score);
    const shortlist=[], seenBoards=new Set();
    for(const c of evaluated.filter(a=>a.result.safe)){
      if(shortlist.length>=beamWidth)break;
      const key=c.result.fruits.map(f=>[f.level,Math.round(f.x/2),Math.round(f.y/2),Math.round(f.vx*10),Math.round(f.vy*10)]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]).map(a=>a.join(',')).join(';');
      if(!seenBoards.has(key) && !shortlist.some(a=>Math.abs(a.x-c.x)<Math.max(5,current.radius*0.35))){shortlist.push(c);seenBoards.add(key);}
    }
    const old=evaluated.find(c=>c.incumbent);
    if(old&&!shortlist.includes(old))shortlist.push(old);
    // 快模型只筛选；最后的少量候选用接近游戏的迭代次数与较长时间复核。
    const beam=[];let baselineScore=null;
    for(const c of shortlist){
      if(options.isCancelled?.())return null;
      c.result=model.simulate(s,current.level,c.x,{accurate:true,seconds:6});simulations++;
      if(c.result?.truncated)timeouts++;
      c.score=evaluate(s,c.result);c.nominal=c.score;
      if(c.incumbent&&c.result?.safe)baselineScore=c.score;
      if(c.result?.safe)beam.push(c);
      yield;
    }
    if(!beam.length)return timeouts ? fallback() : null;
    const jitter=options.jitter ?? Math.max(2,s.layout.width*0.006);
    for(const c of beam){
      c.worst=c.score;c.robust=true;
      for(const direction of [-1,1]){
        if(options.isCancelled?.())return null;
        const x=clamp(c.x+direction*jitter,-s.layout.width/2+current.radius+0.1,s.layout.width/2-current.radius-0.1);
        const perturbed=model.simulate(s,current.level,x,{accurate:true,seconds:6});simulations++;
        if(perturbed?.truncated)timeouts++;
        c.worst=Math.min(c.worst,evaluate(s,perturbed));
        if(!perturbed?.safe)c.robust=false;
        yield;
      }
      c.score=c.score*0.65+c.worst*0.35;
    }
    // 每种假设的下一水果各自选最佳落点，再加权；不读取服务器队列。
    // 不完整的分支不计入价值，避免时间限制让某一候选获得额外奖励。
    const draws=distribution(options.nextProbabilities), futures=new Map(beam.map(c=>[c,[]]));
    let coveredProbability=0;
    for(const draw of draws){
      if(elapsed()>budget)break;
      const branches=beam.map(c=>({c,state:{...s,fruits:c.result.fruits},choices:candidates({...s,fruits:c.result.fruits},draw.level,replyCount),values:[]}));
      let completed=true;
      for(let reply=0;reply<replyCount;reply++){
        for(const branch of branches){
          if(elapsed()>budget){completed=false;break;}
          if(options.isCancelled?.())return null;
          const candidate=branch.choices[reply];if(!candidate)continue;
          const result=model.simulate(branch.state,draw.level,candidate.x);simulations++;
          if(result?.truncated){timeouts++;completed=false;break;}
          branch.values.push(evaluate(s,result));yield;
        }
        if(!completed)break;
      }
      if(!completed)break;
      coveredProbability+=draw.p;
      for(const branch of branches)futures.get(branch.c).push({p:draw.p,value:Math.max(-100000,...branch.values)});
    }
    for(const c of beam){
      const h=health(s,c.result.fruits).value, list=futures.get(c);
      const delta=list.reduce((sum,f)=>sum+f.p*(f.value-h),0);
      const worst=list.length ? Math.min(...list.map(f=>f.value-h)) : 0;
      c.score+=0.35*delta+0.08*Math.min(0,worst);
    }
    const safe=beam.filter(c=>c.robust && (baselineScore===null || c.nominal>=baselineScore-8)).sort((a,b)=>b.score-a.score || Math.abs(a.x)-Math.abs(b.x));
    const best=safe[0];if(!best)return timeouts ? fallback() : null;
    return { x:best.x,y:best.y,score:best.score,safe:true,merge:best.result.chain>0,chain:best.result.chain,
      level:current.level,fruitId:current.id,round:s.round,hitId:best.result.hitId,resulting:best.result.resulting,
      method:'physics-expectimax',diagnostics:{simulations,rootCandidates:evaluated.length,beam:beam.length,
        nextCoverage:coveredProbability,depth:coveredProbability>0?2:1,jitter,timeouts,elapsedMs:Math.round(elapsed()),
        predictedTop:best.result.maxTop,settled:best.result.settled,nextPrior:draws,baselineX:incumbent?.x ?? null,
        baselineScore,nominalScore:best.nominal,model:'Planck 1.5.0 / approximate Cocos 3.8.6'} };
  }
  function plan(s,options={}) { const it=search(s,options);let next;do{next=it.next();}while(!next.done);return next.value; }
  async function planAsync(s,options={}) {
    const it=search(s,options);let slice=performance.now();
    for(;;){const next=it.next();if(next.done)return next.value;
      if(performance.now()-slice>12){await new Promise(resolve=>setTimeout(resolve,0));slice=performance.now();}}
  }
  function stable(previous,current) {
    if(!validState(current)||current.pendingDrop||current.merging||current.droppingFruitId!==null)return false;
    if(!previous||!Array.isArray(previous.fruits)||previous.round!==current.round||previous.currentFruitId!==current.currentFruitId)return false;
    const dropped=current.fruits.filter(f=>f.dropped),old=previous.fruits.filter(f=>f.dropped);
    if(dropped.length!==old.length)return false;
    return dropped.every(f=>{const p=old.find(p=>p.id===f.id);return p&&!f.merging&&Math.hypot(f.vx||0,f.vy||0)<1&&
      Math.abs(f.omega||0)<0.15&&Math.hypot(f.x-p.x,f.y-p.y)<0.6;});
  }
  const api={plan,planAsync,stable,validState,landing,mergeable,candidates,health,evaluate,distribution};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.WatermelonScenePlanner=api;
})(typeof globalThis!=='undefined'?globalThis:this);
