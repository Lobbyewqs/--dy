const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../scene-planner.js');
const M=require('../physics-model.js');
const Controller=require('../controller.js');
const Baseline=require('../greedy-baseline.js');
const {state,fruit}=require('./fixtures.cjs');
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS',name);}
async function main(){
await test('自由落体在真实半径对应的地面停止',()=>{const s=state();const r=M.simulate(s,2,0);assert.ok(r.settled);assert.ok(Math.abs(r.fruits[0].y-(-329))<0.5);assert.equal(r.chain,0);});
await test('偏心碰撞会滚离大水果，区别于垂直落点',()=>{const s=state([fruit(2,6,0,-291)]);const r=M.simulate(s,2,55);assert.ok(r.resulting.x>90);assert.ok(r.resulting.y<-300);});
await test('同级接触生成下一等级，并以较低水果为中心',()=>{const s=state([fruit(2,2,100,-329)]);const r=M.simulate(s,2,100);assert.equal(r.chain,1);assert.equal(r.fruits.length,1);assert.equal(r.fruits[0].level,3);assert.ok(Math.abs(r.fruits[0].x-100)<0.5);assert.equal(r.fruits[0].radius,s.radii[2]);});
await test('真实物理模拟也遵守11级上限',()=>{const s=state([fruit(2,11,0,-231)],11);const r=M.simulate(s,11,0);assert.equal(r.chain,0);assert.equal(r.fruits.length,2);assert.ok(r.fruits.every(f=>f.level===11));});
await test('预测世界不会改变输入状态',()=>{const s=state([fruit(2,2,90,-329)]),before=JSON.stringify(s);M.simulate(s,2,90);assert.equal(JSON.stringify(s),before);});
await test('重复预测在相同参数下可复现',()=>{const s=state([fruit(2,6,0,-291)]);assert.deepEqual(M.simulate(s,2,55),M.simulate(s,2,55));});
await test('单次物理推演超时后不会把未完成结果当成安全结果',()=>{const r=M.simulate(state(),2,0,{maxMs:0});assert.equal(r.truncated,true);assert.equal(r.safe,false);assert.equal(r.settled,false);});
await test('物理模型超时会明确回退到旧策略',()=>{const simulate=M.simulate;M.simulate=()=>({fruits:[],gain:0,dead:false,safe:false,settled:false,truncated:true});try{const s=state(),p=P.plan(s);assert.equal(p.method,'greedy-fallback');assert.equal(p.x,Baseline.plan(s).x);assert.ok(p.diagnostics.timeouts>0);}finally{M.simulate=simulate;}});
await test('合成的径向推力会影响周围水果',()=>{const s=state([fruit(2,2,0,-329),fruit(3,5,90,-303)]);const a=M.simulate(s,2,0);const b=M.simulate({...s,physics:{explosionPowers:Array(11).fill(7)}},2,0);assert.notDeepEqual(a.fruits.map(f=>[f.x,f.y]),b.fruits.map(f=>[f.x,f.y]));});
await test('危险线附近的高堆叠受到更高惩罚',()=>{const s=state(),low=[fruit(2,5,0,-303)],high=[fruit(2,5,0,230)];assert.ok(P.health(s,low).value>P.health(s,high).value+150);});
await test('保留不同横向区域的候选',()=>{const s=state([fruit(2,2,100,-329)]);const xs=P.candidates(s,2,36).map(c=>c.x);assert.ok(xs.some(x=>x<-150));assert.ok(xs.some(x=>x>150));assert.ok(xs.some(x=>Math.abs(x-100)<1));});
await test('无效下一水果先验回到明确的均匀假设',()=>{assert.deepEqual(P.distribution([NaN,-1,0]),P.distribution(null));const d=P.distribution([1,3]);assert.equal(d[1].p,.75);assert.ok(!d.some(a=>a.level>2));});
await test('不合法的物理参数不会进入预测器',()=>{const s=state();s.physics={gravity:NaN};assert.equal(P.plan(s),null);s.physics={explosionPowers:Array(11).fill(Infinity)};assert.equal(P.plan(s),null);});
await test('两步搜索覆盖未知下一水果且包含微扰验证',()=>{const p=P.plan(state([fruit(2,2,100,-329)]),{budgetMs:Infinity});assert.equal(p.method,'physics-expectimax');assert.equal(p.diagnostics.depth,2);assert.ok(Math.abs(p.diagnostics.nextCoverage-1)<1e-8);assert.ok(p.diagnostics.simulations>p.diagnostics.rootCandidates);assert.ok(p.diagnostics.jitter>=2);});
await test('高精度落子结果不为未来猜测显著牺牲当前局面',()=>{const fixtures=[state(),state([fruit(2,2,100,-329)]),state([fruit(2,2,-180,-329),fruit(3,6,0,-291),fruit(4,4,180,-315)])];for(const s of fixtures){const a=Baseline.plan(s),b=P.plan(s,{budgetMs:Infinity});assert.ok(a&&b);const before=M.simulate(s,2,a.x,{accurate:true,seconds:6}),after=M.simulate(s,2,b.x,{accurate:true,seconds:6});assert.ok(P.evaluate(s,after)>=P.evaluate(s,before)-8-1e-6);}});
await test('预算不足时返回已验证的单步结果，不伪称两步完成',()=>{const p=P.plan(state(),{budgetMs:0});assert.equal(p.diagnostics.depth,1);assert.equal(p.diagnostics.nextCoverage,0);assert.ok(p.safe);});
await test('异步搜索可在中途取消并让出主线程',async()=>{let cancel=false,ticked=false;setTimeout(()=>{cancel=true;ticked=true;},0);const p=await P.planAsync(state([fruit(2,6,0,-291)]),{isCancelled:()=>cancel,budgetMs:Infinity});assert.ok(ticked);assert.equal(p,null);});
await test('角速度仍较高时不认为场景稳定',()=>{const a=state([fruit(2,6,0,-291)]),b=structuredClone(a);b.fruits[1].omega=0.3;assert.equal(P.stable(a,b),false);});
await test('异步推演期间暂停不会投放',async()=>{const s=state();let resolve,calls=0;const planner={...P,planAsync:()=>new Promise(r=>resolve=r)};const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>({state:s,armed:true}),drop:async()=>{calls++;return{accepted:true};}},planner);await c.start();await c.tick();await c.tick();const pending=c.tick();await Promise.resolve();await c.stop();resolve({x:0,fruitId:1,round:7});await pending;assert.equal(calls,0);});
await test('推演后再次读取会拒绝移动过的棋盘',async()=>{const s=state([fruit(2,6,0,-291)]);let reads=0,calls=0;const planner={...P,planAsync:async()=>({x:0,fruitId:1,round:7})};const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>{reads++;const next=structuredClone(s);if(reads>=4)next.fruits[1].x=5;return{state:next,armed:true};},drop:async()=>{calls++;return{accepted:true};}},planner);await c.start();await c.tick();await c.tick();const r=await c.tick();assert.match(r.message,/重新等待稳定/);assert.equal(calls,0);await c.stop();});
await test('完整油猴包隔离页面的AMD和module全局',()=>{let script=fs.readFileSync(require('node:path').resolve(__dirname,'../douyu-watermelon-helper-v0.3.user.js'),'utf8');script=script.slice(script.indexOf('(function(){'),script.indexOf('// 游戏画布可能'))+'globalThis.testAPI={WatermelonSceneReader,WatermelonScenePlanner,WatermelonController};})();';let amdCalls=0;const define=()=>amdCalls++;define.amd={};const context=vm.createContext({module:{exports:{page:true}},define,Map,Set,performance,setTimeout,console});vm.runInContext(script,context);assert.equal(amdCalls,0);assert.ok(context.testAPI.WatermelonScenePlanner);assert.equal(context.module.exports.page,true);assert.equal(context.planck,undefined);});
console.log(count+' strategy tests passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
