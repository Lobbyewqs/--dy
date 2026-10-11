const fs=require('node:fs'),path=require('node:path');
const base=path.resolve(__dirname,'browser-preview'),route=path.join(base,'pages/vibe-lab-act202607-game/home');
fs.mkdirSync(route,{recursive:true});const source=path.resolve(__dirname,'..');
for(const f of ['vendor/planck.min.js','planck-bridge.js','physics-model.js'])fs.copyFileSync(path.join(source,f),path.join(base,path.basename(f)));
fs.copyFileSync(path.join(source,'douyu-watermelon-helper-v0.4.user.js'),path.join(base,'helper.user.js'));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>v0.4 动态棋盘验证</title>
<style>body{background:#e5eee8;color:#243c2b;font:16px system-ui;margin:24px}main{width:375px;height:427px;background:#fbd9df;border:2px solid #739a7c}canvas{width:375px;height:427px}p{max-width:650px}#stats{font-weight:bold}button{padding:6px;margin-right:8px}</style>
<h1>v0.4 · 动态棋盘验证</h1><p>本机模拟：持续推进物理、投放动画与冷却。水果仍在运动时投放；此处不是真实斗鱼游戏。</p>
<p id="stats">等待画布</p><button id="modal">显示道具弹窗</button><button id="clear">关闭弹窗</button><main><canvas id="GameCanvas" width="375" height="427"></canvas></main><script type="application/json" id="test-events">{}</script>
<script src="/planck.min.js"></script><script src="/planck-bridge.js"></script><script src="/physics-model.js"></script><script>
const radii=[19,31,41,45,57,69,73,98,117,124,129];let seq=101,previous=performance.now(),lastDrop=0,lowSpeedSince=0;
const layout={width:532,floor:-360,danger:320,top:340,dropY:371};
const fruit=(id,level,x,y,dropped)=>({id,level,kind:'normal',x,y,radius:radii[level-1],dropped,merging:false,vx:0,vy:0,omega:0,age:2});
let fruits=[fruit(1,2,0,371,false),{...fruit(100,2,100,-329,true),omega:0.6}];
const events={times:[],movingDrops:0,rotatingDrops:0,plans:[],errors:[]};
const game={sceneMode:'normal',fruits:new Map(),fruitsById:new Map(),isPlaying:true,gameOver:false,toolMode:'none',toolUseInProgress:false,pendingDrop:false,normalGameGeneration:7,dropCount:0,score:0,currentFruit:{id:1,radius:31,node:{isValid:true}},mergeQueue:[],droppingFruitId:null,playWidth:532,playTop:340,dangerY:320,dropY:371,visibleWidth:750,visibleHeight:854,nextDropAllowedAt:0,
getFruitRadius:l=>radii[l-1],getFruitFloorY:()=>-360,getCore:()=>({explosionLevelPower:l=>Math.max(0,l-4)}),getFruitDebugSnapshots:()=>fruits.map(f=>({...f})),
canStartDropTouch(){return Boolean(this.currentFruit)&&!this.pendingDrop&&!this.gameOver&&Date.now()/1000>=this.nextDropAllowedAt&&!fruits.some(f=>f.dropped&&f.id!==this.droppingFruitId&&f.y+f.radius>320)},
dropCurrentFruitAt(x){if(!this.canStartDropTouch())return;this.pendingDrop=true;const original=this.currentFruit,id=original.id,ready=fruits.find(f=>f.id===id);
const delay=Math.min(.22,Math.max(.12,Math.abs(x-ready.x)/1200));
events.times.push(Date.now());events.movingDrops+=Number(fruits.some(f=>f.dropped&&Math.hypot(f.vx,f.vy)>.06));events.rotatingDrops+=Number(fruits.some(f=>f.dropped&&Math.abs(f.omega)>.15));
setTimeout(()=>{ready.x=x;ready.y=this.dropY;ready.dropped=true;ready.age=delay;ready.vx=0;ready.vy=0;this.droppingFruitId=id;lowSpeedSince=0;this.currentFruit=null;this.pendingDrop=false;this.dropCount++;lastDrop=Date.now();
setTimeout(()=>{const level=[3,1,2,4,2,1,5][(this.dropCount-1)%7];seq=Math.max(seq,...fruits.map(f=>f.id))+1;this.dropY=340+radii[level-1];layout.dropY=this.dropY;const f=fruit(seq++,level,0,this.dropY,false);fruits.push(f);this.currentFruit={id:f.id,radius:f.radius,node:{isValid:true}};this.nextDropAllowedAt=Date.now()/1000+.18;},200);},delay*1000);}}
const modal={isValid:true,activeInHierarchy:false,name:'ToolDialogLayer',children:[],getComponents:()=>[]};
const node={isValid:true,activeInHierarchy:true,name:'Canvas',children:[modal],getComponents:()=>[game]},scene={isValid:true,activeInHierarchy:true,name:'game',children:[node],getComponents:()=>[]};
const cc={Component:class{},director:{getScene:()=>scene}};window.System={resolve:()=>'/cc.js',get:()=>cc};
document.getElementById('modal').onclick=()=>{modal.activeInHierarchy=true;document.getElementById('modal').textContent='道具弹窗已显示';};document.getElementById('clear').onclick=()=>{modal.activeInHierarchy=false;document.getElementById('modal').textContent='显示道具弹窗';};
function tick(){const now=performance.now(),dt=Math.min(.05,(now-previous)/1000);previous=now;
const ready=fruits.filter(f=>!f.dropped),r=WatermelonPhysicsModel.simulate({layout,radii,fruits},2,0,{noDrop:true,seconds:dt,continuous:true,accurate:true,maxMs:Infinity});
fruits=r.fruits.map(f=>({...f,age:f.age+dt})).concat(ready);game.score+=r.gain;seq=Math.max(seq,...fruits.map(f=>f.id));game.gameOver=r.dead;
game.fruitsById=new Map(fruits.map(f=>[f.id,{body:{angularVelocity:f.omega}}]));
const dropping=fruits.find(f=>f.id===game.droppingFruitId);if(!dropping)game.droppingFruitId=null;
else if(Math.hypot(dropping.vx,dropping.vy)<.02){if(!lowSpeedSince)lowSpeedSince=Date.now();if(Date.now()-lowSpeedSince>500)game.droppingFruitId=null;}else lowSpeedSince=0;
render();setTimeout(tick,33);}
function render(){const canvas=document.getElementById('GameCanvas'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,375,427);ctx.strokeStyle='#c25b5b';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(54,53.5);ctx.lineTo(321,53.5);ctx.stroke();ctx.setLineDash([]);for(const f of fruits){const x=187.5+f.x*.5,y=213.5-f.y*.5;ctx.fillStyle=['#6c79cc','#ffa533','#a0c755','#e58aaa','#b9bd4c','#dd6b5e'][Math.min(f.level-1,5)];ctx.beginPath();ctx.arc(x,y,f.radius*.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#243c2b';ctx.font='bold 16px system-ui';ctx.textAlign='center';ctx.fillText(String(f.level),x,y+5);}document.getElementById('stats').textContent='确认投放 '+game.dropCount+' · 运动中投放 '+events.movingDrops+' · 模拟收益 '+game.score;
const info=document.getElementById('wm-helper-state');if(info?.textContent){const data=JSON.parse(info.textContent);if(data.plan&&events.plans.at(-1)?.fruitId!==data.plan.fruitId)events.plans.push({fruitId:data.plan.fruitId,method:data.plan.method,ms:data.plan.diagnostics.elapsedMs});if(data.modelError!=null)events.errors.push(data.modelError);}
document.getElementById('test-events').textContent=JSON.stringify({...events,intervals:events.times.slice(1).map((t,i)=>t-events.times[i])});}
tick();
</script><script src="/helper.user.js"></script></html>`;
fs.writeFileSync(path.join(route,'index.html'),html);console.log(base);

const http=require('node:http');http.createServer((request,response)=>{try{const requested=new URL(request.url,'http://localhost').pathname;let file=path.resolve(base,'.'+decodeURIComponent(requested));if(!file.startsWith(base+path.sep)){response.writeHead(403);return response.end();}if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');response.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');response.end(fs.readFileSync(file));}catch(_){response.writeHead(404);response.end('Not found');}}).listen(8767,'127.0.0.1',()=>console.log('Open http://127.0.0.1:8767/pages/vibe-lab-act202607-game/home/ ; Ctrl+C to stop'));
