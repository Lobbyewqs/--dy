const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const P=require('../scene-planner.js'),M=require('../physics-model.js'),Controller=require('../controller.js');
const {state,fruit}=require('./fixtures.cjs');let count=0;
async function test(name,fn){await fn();count++;console.log('PASS',name);}
const moving=()=>{const s=state([fruit(2,6,0,-291)]);s.fruits[1].vx=0.08;s.fruits[1].omega=0.7;s.droppingFruitId=2;return s;};
async function main(){
await test('游戏已就绪时，角速度和上一水果标记不再阻止投放',()=>{const s=moving();assert.equal(P.stable(s,s),false);assert.equal(P.eligible(s),true);assert.ok(P.plan(s));});
await test('仍由游戏冷却、待投动画和合成队列控制就绪',()=>{for(const key of ['pendingDrop','merging','toolBusy']){const s=state();s[key]=true;assert.equal(P.plan(s),null);}const s=state();s.ready=false;assert.equal(P.plan(s),null);});
await test('投放动画按横移距离取0.12至0.22秒',()=>{assert.equal(P.releaseDelay(state(),0),0.12);assert.equal(P.releaseDelay(state(),250),250/1200);const s=state();s.fruits[0].x=-250;assert.equal(P.releaseDelay(s,250),0.22);});
await test('模型推迟释放期间，棋盘运动而待投水果尚未自由落体',()=>{const s=state();const r=M.simulate(s,2,0,{releaseDelay:0.22,seconds:0.2,capture:true,maxMs:Infinity});assert.equal(r.trace.length,0);assert.equal(r.fruits.length,0);});
await test('模型使用实际dropY并保留连续碰撞',()=>{const s=state();s.layout.dropY=220;const r=M.simulate(s,2,0,{releaseDelay:0.12,seconds:0.3,continuous:true,capture:true,maxMs:Infinity});assert.ok(r.trace.length>0);assert.ok(r.trace[0].y<=220&&r.trace[0].y>210);});
await test('空场首次碰撞识别为地面，不误报合成',()=>{const r=M.simulate(state(),2,0,{continuous:true,seconds:2,maxMs:Infinity});assert.equal(r.firstContact.id,null);assert.equal(r.firstContact.merge,false);});
await test('同级目标的首次碰撞与即时合成可核对',()=>{const r=M.simulate(state([fruit(2,2,100,-329)]),2,100,{releaseDelay:0.2,continuous:true,seconds:2,maxMs:Infinity});assert.equal(r.firstContact.id,2);assert.ok(r.firstContact.merge);assert.ok(r.chain>0);});
await test('不读取未知下一水果，也不把多次远期连锁作为收益',()=>{const p=P.plan(state([fruit(2,2,100,-329)]));assert.equal(p.diagnostics.depth,1);assert.ok(p.chain<=1);assert.equal(p.diagnostics.nextPrior,undefined);});
await test('模型超时回退到明确标注的几何落点',()=>{const original=M.simulate;try{M.simulate=()=>({truncated:true});const p=P.plan(state());assert.equal(p.method,'reactive-geometry');assert.ok(p.diagnostics.fallback);}finally{M.simulate=original;}});
await test('已完成的模型均判定危险时不会用几何回退掩盖危险',()=>{const original=M.simulate;try{M.simulate=()=>({truncated:false,firstContact:{id:null},safe:false});assert.equal(P.plan(state()),null);}finally{M.simulate=original;}});
await test('匀速小幅运动可通过提交前检查',()=>{const a=moving(),b=structuredClone(a);b.updatedAt=a.updatedAt+100;b.fruits[1].x+=0.08*32*0.1;assert.ok(P.compatible(a,b));});
await test('新合成、明显偏离和过期快照会触发重新规划',()=>{const a=moving(),b=structuredClone(a);b.fruits[1].id=20;assert.equal(P.compatible(a,b),false);b.fruits[1].id=2;b.fruits[1].x+=50;assert.equal(P.compatible(a,b),false);b.fruits[1].x=0;b.updatedAt=a.updatedAt+500;assert.equal(P.compatible(a,b),false);});
await test('输入棋盘与物理世界相互隔离',()=>{const s=moving(),before=JSON.stringify(s);P.plan(s);assert.equal(JSON.stringify(s),before);});
await test('悬空水果瞬时零速不会被错误冻结',()=>{const s=state([fruit(2,2,0,100)]);const r=M.simulate(s,2,200,{noDrop:true,seconds:0.2,maxMs:Infinity});assert.ok(r.fruits[0].y<85);assert.ok(r.fruits[0].vy<0);});
await test('偏差对照使用轨迹插值，避免采样时差被误算成模型误差',()=>{const c=new Controller({});const s=state([fruit(2,2,5,-329)]);s.updatedAt=10200;c.watch={fruitId:1,lastSample:-1,prediction:{at:10000,trace:[],forecast:[{t:0.1,fruits:[{id:2,x:0,y:-329}]},{t:0.3,fruits:[{id:2,x:10,y:-329}]}]}};c.observe(s);assert.ok(c.modelError<1e-8);});
await test('短期预测包含动画延迟和可对照的轨迹',()=>{const p=P.plan(state(),{budgetMs:500});assert.equal(p.method,'reactive-short-physics');assert.ok(p.diagnostics.releaseDelay>=0.12);assert.ok(p.prediction.trace.length);assert.equal(p.diagnostics.continuous,true);assert.ok(p.diagnostics.horizon<2.1);});
await test('异步预测期间可以取消',async()=>{let cancelled=false;setTimeout(()=>cancelled=true,0);const p=await P.planAsync(moving(),{isCancelled:()=>cancelled});assert.equal(p,null);});
await test('持续运动20秒也不会触发旧版的静止等待超时',async()=>{const s=moving();let now=10000,drops=0;const real=Date.now;Date.now=()=>now;try{
 const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>({state:{...s,updatedAt:now},armed:true}),drop:async()=>{drops++;return {accepted:true};}});
 await c.start();now+=21000;await c.tick();assert.equal(drops,1);assert.ok(c.running);await c.stop();
}finally{Date.now=real;}});
await test('预测偏差较大时自动降低物理模型权重',async()=>{const s=state();let weight;const planner={...P,planAsync:async(a,options)=>{weight=options.modelTrust;return P.plan(a,{mode:'greedy'});}};
 const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>({state:s,armed:true}),drop:async()=>({accepted:true})},planner);await c.start();c.modelError=36;await c.tick();assert.ok(weight<0.2);await c.stop();});
await test('观测偏差按对应水果位置计算',()=>{const c=new Controller({});const s=state([fruit(2,2,10,-329)]);s.updatedAt=10200;c.watch={fruitId:1,lastSample:-1,prediction:{at:10000,trace:[],forecast:[{t:0.2,fruits:[{id:2,x:0,y:-329}]}]}};c.observe(s);assert.equal(c.modelError,10);assert.equal(c.errorSamples,1);});
await test('暂停发生在异步推演中，仍不会投放',async()=>{const s=state();let resolve,calls=0;const planner={...P,planAsync:()=>new Promise(r=>resolve=r)};
 const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>({state:s,armed:true}),drop:async()=>{calls++;return {accepted:true};}},planner);await c.start();const pending=c.tick();await Promise.resolve();await c.stop();resolve(P.plan(s,{mode:'greedy'}));await pending;assert.equal(calls,0);});
await test('提交时过期不会被当成成功投放，也不会重复确认',async()=>{const s=state();const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>({state:s,armed:true}),drop:async()=>({accepted:false,retryable:true})});await c.start();const r=await c.tick();assert.match(r.message,/下一帧重算/);assert.equal(c.pending,null);assert.equal(c.count,0);assert.ok(c.running);await c.stop();});
await test('合成队列与弹窗仍会阻止旧落点提交',async()=>{const s=state();let n=0,calls=0;const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>({state:++n===1?s:{...s,blocking:'ToolDialogLayer'},armed:true}),drop:async()=>{calls++;return{accepted:true};}});await c.start();await assert.rejects(()=>c.tick(),/弹窗/);assert.equal(calls,0);await c.stop();});
await test('完整油猴包隔离页面AMD和module全局',()=>{let script=fs.readFileSync(path.resolve(__dirname,'../douyu-watermelon-helper-v0.4.user.js'),'utf8');script=script.slice(script.indexOf('(function(){'),script.indexOf('// 游戏画布可能'))+'globalThis.testAPI={WatermelonSceneReader,WatermelonScenePlanner,WatermelonController};})();';let calls=0;const define=()=>calls++;define.amd={};const context=vm.createContext({module:{exports:{page:true}},define,Map,Set,performance,setTimeout,console,Date});vm.runInContext(script,context);assert.equal(calls,0);assert.ok(context.testAPI.WatermelonScenePlanner);assert.equal(context.module.exports.page,true);assert.equal(context.planck,undefined);});
console.log(count+' dynamic tests passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
