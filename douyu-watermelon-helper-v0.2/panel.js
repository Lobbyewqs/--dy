'use strict';
const $ = id => document.getElementById(id);
let connected = false, timer = null, lastPlan = null, lastState = null, statusLocked = false, pollEpoch = 0;
async function message(type, data = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...data });
  if (!r?.ok) throw new Error(r?.error || '后台无响应，请重新打开助手');
  return r;
}
const controller = new WatermelonController({
  start: async () => (await message('start')).state,
  stop: () => message('stop'), read: () => message('read'), drop: plan => message('drop', { plan })
});
const palette = ['#627acc','#f5a328','#a3cc5e','#e56391','#b1be4d','#db645b','#efaa8a','#dfb34d','#a48465','#ef8871','#75a753'];
function draw(s, plan) {
  const canvas = $('board'), c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (!s?.found) return;
  const l = s.layout, top = Math.max(l.dropY + Math.max(...s.radii.slice(0,5)), l.danger + 80);
  const scale = Math.min((canvas.width - 30) / l.width, (canvas.height - 30) / (top - l.floor));
  const sx = x => canvas.width / 2 + x * scale;
  const sy = y => canvas.height - 15 - (y - l.floor) * scale;
  c.strokeStyle = '#6a8d73'; c.lineWidth = 2; c.strokeRect(sx(-l.width/2), sy(top), l.width*scale, (top-l.floor)*scale);
  c.strokeStyle = '#f47b71'; c.setLineDash([6,5]); c.beginPath(); c.moveTo(sx(-l.width/2),sy(l.danger)); c.lineTo(sx(l.width/2),sy(l.danger)); c.stroke(); c.setLineDash([]);
  if (plan?.round === s.round && plan.fruitId === s.currentFruitId) {
    c.strokeStyle = '#7bc7f8'; c.beginPath(); c.moveTo(sx(plan.x),sy(l.dropY)); c.lineTo(sx(plan.x),sy(plan.y)); c.stroke();
  }
  for (const f of s.fruits) {
    c.fillStyle = palette[f.level-1]; c.globalAlpha = f.dropped ? 1 : .65;
    c.beginPath(); c.arc(sx(f.x),sy(f.y),f.radius*scale,0,Math.PI*2); c.fill(); c.globalAlpha=1;
    c.fillStyle = '#132219'; c.font = `bold ${Math.max(11,Math.min(20,f.radius*scale))}px sans-serif`; c.textAlign='center'; c.textBaseline='middle'; c.fillText(String(f.level),sx(f.x),sy(f.y));
  }
}
async function poll(token = pollEpoch) {
  clearTimeout(timer);
  if (!connected || token !== pollEpoch) return;
  try {
    const result = await controller.tick();
    if (result && token === pollEpoch) {
      lastState = result.state;
      $('score').textContent = result.state.score;
      $('level').textContent = result.state.fruits.find(f=>f.id===result.state.currentFruitId)?.level ?? '等待';
      $('count').textContent = controller.count;
      if (!statusLocked) $('status').textContent = result.message;
      if (result.plan) lastPlan = result.plan;
      draw(result.state,lastPlan);
    }
  } catch (error) {
    await controller.stop().catch(()=>{}); statusLocked=true; $('status').textContent=error.message;
  }
  $('start').disabled=controller.running;
  if (connected && token === pollEpoch) timer=setTimeout(()=>poll(token),500);
}
function action(id,fn) { $(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>{ $('status').textContent=e.message; })); }
action('connect',async()=>{const token=++pollEpoch; connected=false; clearTimeout(timer); await controller.stop().catch(()=>{}); const r=await message('connect'); if(token!==pollEpoch)return; connected=true; statusLocked=false; draw(r.state); void poll(token);});
action('start',async()=>{if(!connected)throw new Error('请先连接游戏'); const seconds=Number($('interval').value); if(!Number.isFinite(seconds)||seconds<1.2||seconds>8)throw new Error('间隔范围为 1.2～8 秒'); controller.interval=seconds*1000; await controller.start(); statusLocked=false; $('start').disabled=controller.running;});
action('stop',async()=>{await controller.stop(); statusLocked=true; $('status').textContent='已暂停'; $('start').disabled=false;});
action('disconnect',async()=>{pollEpoch++; connected=false; clearTimeout(timer); await controller.stop().catch(()=>{}); await message('disconnect'); $('status').textContent='已断开'; $('start').disabled=false;});
action('export',()=>{if(!lastState)throw new Error('先连接游戏获取状态');const url=URL.createObjectURL(new Blob([JSON.stringify(lastState,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='watermelon-state.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('stop').click();});
window.addEventListener('pagehide',()=>{chrome.runtime.sendMessage({type:'stop'}).catch(()=>{});});
