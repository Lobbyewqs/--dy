'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const base = path.resolve(__dirname, '..');
const P = require(path.join(base, 'scene-planner.js'));
const Controller = require(path.join(base, 'controller.js'));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS', name); }
const radii = [19,31,41,45,57,69,73,98,117,124,129];
function fruit(id, level, x, y, dropped = true) { return { id, level, kind:'normal', x,y,radius:radii[level-1],dropped,merging:false,vx:0,vy:0,age:2 }; }
function state(fruits = [], level = 2) { return {
  found:true,visible:true,playing:true,gameOver:false,ready:true,pendingDrop:false,merging:false,blocking:null,toolMode:'none',toolBusy:false,
  round:7,dropCount:0,score:0,currentFruitId:1,droppingFruitId:null,radii,
  layout:{width:532,floor:-360,danger:320,top:340,dropY:371,visibleWidth:750,visibleHeight:854},
  fruits:[fruit(1,level,0,371,false),...fruits],updatedAt:Date.now()
}; }

function fixture() {
  const s = state();
  let modalNode = null, visible = true, calls = 0;
  const game = {
    sceneMode:'normal',fruits:new Map(),isPlaying:true,gameOver:false,toolMode:'none',toolUseInProgress:false,pendingDrop:false,
    normalGameGeneration:7,dropCount:0,score:0,currentFruit:{id:1,radius:31,node:{isValid:true}},mergeQueue:[],droppingFruitId:null,
    playWidth:532,playTop:340,playBottom:-377,dangerY:320,dropY:371,visibleWidth:750,visibleHeight:854,
    getFruitRadius: level => radii[level-1], getFruitFloorY:()=>-360,
    canStartDropTouch(){return this.isPlaying&&!this.gameOver&&!this.pendingDrop;},
    getFruitDebugSnapshots:()=>s.fruits.map(f=>({...f})),
    dropCurrentFruitAt(x){calls++;this.pendingDrop=true;this.lastX=x;}
  };
  const node={isValid:true,activeInHierarchy:true,name:'Canvas',children:[],getComponents:()=>[game]};
  const scene={isValid:true,activeInHierarchy:true,name:'game',getComponents:()=>[],children:[node]};
  const cc={Component:class {},director:{getScene:()=>scene}};
  const context=vm.createContext({
    module:{exports:{}},Map,console,Date,location:{pathname:'/pages/vibe-lab-act202607-game/home'},
    document:{get visibilityState(){return visible?'visible':'hidden';},getElementById:id=>id==='GameCanvas'?{getBoundingClientRect:()=>({width:375,height:427})}:null},
    System:{resolve:key=>key==='cc'?'https://cdn.test/cc.js':key,get:key=>key==='https://cdn.test/cc.js'?cc:undefined}
  });
  vm.runInContext(fs.readFileSync(path.join(base,'scene-reader.js'),'utf8'),context);
  return {game,state:s,context,read:()=>context.module.exports.run('read'),drop:data=>context.module.exports.run('drop',data),
    calls:()=>calls,setVisible:v=>visible=v,setModal:name=>{node.children= name ? [{isValid:true,activeInHierarchy:true,name,getComponents:()=>[],children:[]}]:[];},node,scene};
}

async function main() {
  await test('真实级别的同类水果优先合成',()=>{const s=state([fruit(2,2,100,-329)]);const p=P.plan(s);assert.ok(p.merge);assert.equal(p.hitId,2);});
  await test('11级水果不再作为同类合并目标',()=>{const s=state([fruit(2,11,0,-231)],11);const p=P.plan(s);assert.ok(p);assert.equal(p.merge,false);});
  await test('同尺寸异级水果不会误判同类',()=>{const a=fruit(1,3,0,0),b=fruit(2,4,0,0);b.radius=a.radius;assert.equal(P.mergeable(a,b),false);});
  await test('挡在上面的异级水果阻止直接合并',()=>{const s=state([fruit(2,2,0,-329),fruit(3,6,0,-230)]);assert.equal(P.plan(s).merge,false);});
  await test('优先选择另一边可触及的同类',()=>{const s=state([fruit(2,2,0,-329),fruit(3,6,0,-230),fruit(4,2,-170,-329)]);const p=P.plan(s);assert.equal(p.hitId,4);assert.ok(p.merge);});
  await test('落点半径与碰撞边界相符',()=>{const s=state();const p=P.plan(s);assert.ok(p.x>=-s.layout.width/2+radii[1]);assert.ok(p.x<=s.layout.width/2-radii[1]);assert.equal(p.y,-329);});
  await test('近邻同级合成提供连锁预测',()=>{const s=state([fruit(2,2,0,-329),fruit(3,3,70,-319)]);const p=P.plan(s);assert.ok(p.merge);assert.ok(p.chain>=2);});
  await test('没有低于结束线的落点时返回空',()=>{const s=state([fruit(2,11,0,230)]);s.layout.width=260;assert.equal(P.plan(s),null);});
  await test('非法半径不会流入投放计划',()=>{const s=state();s.fruits[0].radius=NaN;assert.equal(P.plan(s),null);});
  await test('游戏结束时不产生计划',()=>{const s=state();s.gameOver=true;assert.equal(P.plan(s),null);});
  await test('下落和合成中不认为场景稳定',()=>{const a=state(),b=structuredClone(a);b.droppingFruitId=1;assert.equal(P.stable(a,b),false);b.droppingFruitId=null;b.merging=true;assert.equal(P.stable(a,b),false);});
  await test('同数量水果移动仍能检测出运动',()=>{const a=state([fruit(2,2,0,-329)]),b=structuredClone(a);b.fruits[1].x=3;assert.equal(P.stable(a,b),false);});
  await test('通过System.resolve读取Cocos而非依赖window.cc',()=>{const f=fixture();const s=f.read();assert.equal(s.found,true);assert.equal(s.currentFruitId,1);assert.equal(s.layout.width,532);assert.equal(s.radii.length,11);assert.equal(f.calls(),0);});
  await test('读取场景不触发投放和账号操作',()=>{const f=fixture();for(let i=0;i<10;i++)f.read();assert.equal(f.calls(),0);assert.equal(f.game.pendingDrop,false);assert.ok(!('battleId' in f.read()));});
  await test('仅正常投放方法会收到选定横坐标',()=>{const f=fixture();assert.equal(f.drop({x:100,fruitId:1,round:7}).accepted,true);assert.equal(f.game.lastX,100);assert.equal(f.calls(),1);});
  await test('旧水果ID和旧本局编号都不能投放',()=>{const f=fixture();assert.equal(f.drop({x:0,fruitId:2,round:7}).accepted,false);assert.equal(f.drop({x:0,fruitId:1,round:6}).accepted,false);assert.equal(f.calls(),0);});
  await test('边界、弹窗、道具和隐藏场景均拒绝投放',()=>{const f=fixture();assert.equal(f.drop({x:1000,fruitId:1,round:7}).accepted,false);f.setModal('ReviveDialogLayer');assert.equal(f.read().blocking,'ReviveDialogLayer');assert.equal(f.drop({x:0,fruitId:1,round:7}).accepted,false);f.setModal(null);f.game.toolMode='bomb';assert.equal(f.drop({x:0,fruitId:1,round:7}).accepted,false);f.game.toolMode='none';f.setVisible(false);assert.equal(f.drop({x:0,fruitId:1,round:7}).accepted,false);assert.equal(f.calls(),0);});
  await test('连续命令不会重复投放同一水果',()=>{const f=fixture();f.drop({x:0,fruitId:1,round:7});assert.equal(f.drop({x:0,fruitId:1,round:7}).accepted,false);assert.equal(f.calls(),1);});
  const realNow=Date.now;
  let now=10000;Date.now=()=>now;
  try {
    await test('控制器等待稳定样本，投放后等待计数确认',async()=>{
      const s=state();let armed=false,calls=0;
      const c=new Controller({start:async()=>{armed=true;return structuredClone(s);},stop:async()=>{armed=false;},read:async()=>({state:structuredClone(s),armed}),drop:async()=>{calls++;return{accepted:true};}},P);
      await c.start();await c.tick();now+=600;await c.tick();assert.equal(calls,0);now+=600;await c.tick();assert.equal(calls,1);assert.equal(c.count,0);
      now+=500;await c.tick();assert.equal(calls,1);s.dropCount=1;s.currentFruitId=2;s.fruits=[fruit(2,3,0,371,false),fruit(1,2,0,-329)];now+=500;await c.tick();assert.equal(c.count,1);await c.stop();
      for(let i=0;i<4;i++){now+=600;await c.tick();}assert.equal(calls,1);
    });
    await test('启动中的暂停能取消尚未完成的启动',async()=>{let resolve,stops=0;const c=new Controller({start:()=>new Promise(r=>resolve=r),stop:async()=>{stops++;}},P);const pending=c.start();await c.stop();resolve(state());await pending;assert.equal(c.running,false);assert.ok(stops>=2);});
    await test('暂停到达读取之后，仍不会发起下一投放',async()=>{const s=state();let calls=0,controller;const adapter={start:async()=>s,stop:async()=>{},read:async()=>{await controller.stop();return{state:s,armed:false};},drop:async()=>{calls++;return{accepted:true};}};controller=new Controller(adapter,P);await controller.start();controller.stableFrames=2;await controller.tick();assert.equal(calls,0);});
    await test('场景编号变化会中止本轮控制',async()=>{const s=state();const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>({state:{...s,round:8},armed:true})},P);await c.start();await assert.rejects(()=>c.tick(),/本局结束/);await c.stop();});
    await test('投放确认超时会报错，避免重复点击',async()=>{const s=state();const c=new Controller({start:async()=>s,stop:async()=>{},read:async()=>({state:s,armed:true}),drop:async()=>({accepted:true})},P);await c.start();await c.tick();now+=600;await c.tick();now+=600;await c.tick();now+=2600;await assert.rejects(()=>c.tick(),/投放没有完成/);await c.stop();});
  } finally { Date.now=realNow; }
  await backgroundTests();
  console.log(`\n${passed} tests passed`);
}

async function backgroundTests(){
  const listeners={},calls=[], f=fixture();let active=true;
  const event=name=>({addListener(fn){listeners[name]=fn;}});
  const chrome={
    action:{onClicked:event('action'),setBadgeText:async()=>{}},
    windows:{create:async()=>({id:9}),update:async()=>{},get:async()=>({state:'normal'}),onRemoved:event('windowRemoved')},
    tabs:{get:async()=>({windowId:1,active,status:'complete'}),onActivated:event('activated'),onUpdated:event('updated'),onRemoved:event('removed')},
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:event('message')},
    debugger:{attach:async()=>{},detach:async()=>{},onDetach:event('detach'),onEvent:event('event'),sendCommand:async(target,method,params)=>{
      calls.push({target,method,params});
      if(method==='Runtime.enable'){listeners.event({tabId:42},'Runtime.executionContextCreated',{context:{id:7,auxData:{isDefault:true}}});return{};}
      if(method==='Runtime.evaluate'){return{result:{value:vm.runInContext(params.expression,f.context)}};}
      return{};
    }}
  };
  const context=vm.createContext({chrome,Set,Map,Date,console});
  context.importScripts=name=>vm.runInContext(fs.readFileSync(path.join(base,name),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(base,'background.js'),'utf8'),context);
  const send=m=>new Promise(resolve=>listeners.message(m,{id:'test',url:'chrome-extension://test/panel.html'},resolve));
  await listeners.action({id:42,url:'https://www.douyu.com/6657'});
  assert.equal((await send({type:'connect'})).state.found,true);
  await test('扩展实际表达式可在iframe主环境运行',()=>{assert.ok(calls.some(c=>c.method==='Runtime.evaluate'&&c.params.contextId===7));});
  await test('后台未启动时不允许投放',async()=>{assert.equal((await send({type:'drop',plan:{x:0,fruitId:1,round:7}})).ok,false);assert.equal(f.calls(),0);});
  await send({type:'start'});
  await test('后台和场景双重校验水果ID',async()=>{assert.equal((await send({type:'drop',plan:{x:0,fruitId:99,round:7}})).ok,false);assert.equal(f.calls(),0);});
  await test('扩展通过正常投放方法完成已授权落点',async()=>{assert.equal((await send({type:'drop',plan:{x:100,fruitId:1,round:7}})).accepted,true);assert.equal(f.calls(),1);});
  f.game.pendingDrop=false;await send({type:'start'});active=false;
  await test('后台在标签页隐藏时拒绝读取和投放',async()=>{assert.equal((await send({type:'drop',plan:{x:0,fruitId:1,round:7}})).ok,false);assert.equal((await send({type:'status'})).armed,false);assert.equal(f.calls(),1);});
  active=true;await send({type:'start'});await send({type:'stop'});
  await test('后台暂停后不再调用游戏方法',async()=>{assert.equal((await send({type:'drop',plan:{x:0,fruitId:1,round:7}})).ok,false);assert.equal(f.calls(),1);});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
