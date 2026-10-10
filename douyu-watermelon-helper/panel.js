'use strict';
const $ = id => document.getElementById(id);
const E = WatermelonEngine;
const canvas = $('screen'), ctx = canvas.getContext('2d');
let image = null, bitmap = null, captureView = null;
let board = null, preview = null, colors = [], dropY = null;
let mode = null, drag = null, overlay = null;
let running = false, runGeneration = 0, timer = null, dropped = 0;
let previous = null, beforeDrop = null, stableFrames = 0, waitingSince = 0, lastDropAt = 0;

async function send(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error || '扩展后台未响应，请重新打开面板');
  return response;
}
function status(message) { $('status').textContent = message; }
function task(message) { $('task').textContent = message; }
function number(id) { return Number($(id).value); }
function config() {
  const threshold = number('threshold'), radius = number('radius'), interval = number('interval');
  if (threshold < 12 || threshold > 100 || !Number.isFinite(threshold) ||
      radius < 0.8 || radius > 8 || !Number.isFinite(radius) ||
      interval < 1.2 || interval > 8 || !Number.isFinite(interval)) throw new Error('设置值超出允许范围');
  return { threshold, radius, interval };
}
const absolute = r => ({ x: r.x * canvas.width, y: r.y * canvas.height, w: r.w * canvas.width, h: r.h * canvas.height });

async function decode(data) {
  const img = new Image();
  img.src = `data:image/png;base64,${data}`;
  await img.decode();
  const off = document.createElement('canvas'); off.width = img.width; off.height = img.height;
  const c = off.getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0);
  return { bitmap: img, image: c.getImageData(0, 0, off.width, off.height) };
}

function drawRect(r, color, label) {
  const a = absolute(r);
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, canvas.width / 500);
  ctx.strokeRect(a.x, a.y, a.w, a.h);
  ctx.font = `${Math.max(13, canvas.width / 85)}px sans-serif`;
  ctx.fillStyle = color; ctx.fillText(label, a.x + 4, a.y + 19);
}
function draw() {
  if (!bitmap) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0);
  if (board) drawRect(board, '#7dff8e', '棋盘');
  if (preview) drawRect(preview, '#65b7ff', '待投');
  if (board && dropY !== null) {
    ctx.strokeStyle = '#a6c785'; ctx.setLineDash([6, 6]); ctx.beginPath();
    ctx.moveTo(board.x * canvas.width, dropY * canvas.height);
    ctx.lineTo((board.x + board.w) * canvas.width, dropY * canvas.height); ctx.stroke(); ctx.setLineDash([]);
  }
  if (overlay) {
    ctx.lineWidth = Math.max(2, canvas.width / 650);
    for (const f of overlay.fruits) {
      ctx.strokeStyle = E.similarity(f, overlay.current) >= 0.68 ? '#7dff8e' : '#ffb454';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
    }
    const f = overlay.current;
    ctx.strokeStyle = '#65b7ff'; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
    if (overlay.plan) {
      const p = overlay.plan;
      ctx.strokeStyle = '#ff7064'; ctx.beginPath(); ctx.moveTo(p.x, board.y * canvas.height); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, f.r, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (drag) drawRect({ x: Math.min(drag.x, drag.toX), y: Math.min(drag.y, drag.toY), w: Math.abs(drag.toX - drag.x), h: Math.abs(drag.toY - drag.y) }, '#fff', '框选');
}

async function pause(reason = '已暂停') {
  running = false; runGeneration++; clearTimeout(timer); timer = null;
  await send('stop').catch(() => {});
  task('已暂停');
  $('start').disabled = false;
  for (const id of ['capture','board','preview','background','drop','inspect','threshold','radius','interval','connect']) $(id).disabled = false;
  status(reason);
}

async function captureFresh() {
  await pause('正在截图');
  const result = await send('capture');
  const decoded = await decode(result.data);
  image = decoded.image; bitmap = decoded.bitmap; captureView = result.view;
  canvas.width = image.width; canvas.height = image.height;
  canvas.style.maxWidth = `calc(68vh * ${image.width / image.height})`;
  board = null; preview = null; colors = []; dropY = null; overlay = null; mode = null;
  $('verified').checked = false; $('empty').hidden = true; $('empty').style.display = 'none';
  draw(); task('依次完成右侧校准'); status('截图已获取。先框选棋盘内部。');
}

function requireCalibration() {
  if (!image || !board || !preview || !colors.length || dropY === null) throw new Error('请完成棋盘、待投水果、背景色和点击高度四项校准');
}

function analyze(frame) {
  requireCalibration();
  const settings = config(), b = absolute(board), p = absolute(preview);
  const current = E.currentFruit(frame, p, settings.threshold);
  if (!current) throw new Error('没有识别到待投水果；可能本局已结束，或待投区域需要重新框选');
  if (current.r > b.w * 0.4 || current.r < b.w * 0.008) throw new Error('待投水果尺寸异常，请重新框选');
  const result = E.detect(frame, b, colors, settings.threshold, Math.max(4, b.w * settings.radius / 100), p);
  if (result.fraction > 0.74) throw new Error('棋盘内非背景区域过多：可能弹窗、背景取色错误或本局已结束');
  if (result.fraction > 0.08 && result.fruits.length === 0) throw new Error('棋盘有内容但无法识别水果，请调整背景色容差或重新框选');
  const plan = E.plan(b, result.fruits, current);
  if (!plan) throw new Error('没有可用落点');
  return { ...result, current, plan };
}

function point(event) {
  const box = canvas.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
}
canvas.addEventListener('pointerdown', event => {
  if (!image || running || !mode) return;
  const p = point(event);
  $('verified').checked = false; overlay = null;
  if (mode === 'background') {
    if (!board || p.x <= board.x || p.x >= board.x + board.w || p.y <= board.y || p.y >= board.y + board.h) { status('请在棋盘框内点击空白背景'); return; }
    colors.push(E.pixel(image, p.x * canvas.width, p.y * canvas.height));
    if (colors.length > 6) colors.shift();
    status(`已采集 ${colors.length} 个背景色，可继续点击空白背景，或进入第 4 步`); draw(); return;
  }
  if (mode === 'drop') {
    if (!board || p.y < board.y || p.y > board.y + board.h || p.x < board.x || p.x > board.x + board.w) { status('投放点击位置必须在棋盘框内'); return; }
    dropY = p.y; mode = null; draw(); task('检测并核对识别结果'); status('点击高度已设定。接着检测预览。'); return;
  }
  drag = { x: p.x, y: p.y, toX: p.x, toY: p.y }; canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => { if (!drag) return; const p = point(event); drag.toX = p.x; drag.toY = p.y; draw(); });
canvas.addEventListener('pointerup', event => {
  if (!drag) return;
  const p = point(event); drag.toX = p.x; drag.toY = p.y;
  const r = { x: Math.min(drag.x, drag.toX), y: Math.min(drag.y, drag.toY), w: Math.abs(drag.x - drag.toX), h: Math.abs(drag.y - drag.toY) };
  drag = null;
  if (r.w * canvas.width < 15 || r.h * canvas.height < 15) { status('框选区域太小，请重新拖动'); draw(); return; }
  if (mode === 'board') { board = r; colors = []; dropY = null; }
  else if (mode === 'preview') preview = r;
  mode = null; draw(); status('区域已保存，请继续下一步');
});
canvas.addEventListener('pointercancel', () => { drag = null; draw(); });

function selectMode(value, message) {
  if (!image) throw new Error('请先连接并截图');
  mode = value; overlay = null; $('verified').checked = false; task(message); draw();
}
function action(id, fn) {
  $(id).addEventListener('click', () => Promise.resolve().then(fn).catch(error => status(error.message)));
}
action('connect', async () => { await send('connect'); await captureFresh(); });
action('capture', captureFresh);
action('board', () => selectMode('board', '拖动框选：结束线到容器底部的内部区域'));
action('preview', () => selectMode('preview', '拖动框选：本次待投水果及周围空白'));
action('background', () => selectMode('background', '点击棋盘内空白背景，可取多个样本'));
action('drop', () => selectMode('drop', '点击棋盘内可投放的位置，以记录操作高度'));
action('inspect', () => {
  overlay = analyze(image); draw();
  task('核对识别圆圈，然后开始');
  status(`识别到 ${overlay.fruits.length} 个棋盘水果。待投半径 ${overlay.current.r.toFixed(1)} 像素。\n建议：${overlay.plan.merge ? '对准可触及的同类水果' : '放入较低空隙'}。\n如果圈出文字、边框，或漏掉大部分水果，请重新校准。`);
});
action('stop', () => pause());
action('disconnect', async () => { await pause(); await send('disconnect'); status('已断开连接'); });
for (const id of ['threshold','radius','interval']) $(id).addEventListener('input', () => { $('verified').checked = false; overlay = null; draw(); });

async function loop(token) {
  if (!running || token !== runGeneration) return;
  try {
    const state = await send('status');
    if (!state.armed) throw new Error('目标状态改变，自动运行已暂停');
    const capture = await send('capture');
    const decoded = await decode(capture.data);
    if (!running || token !== runGeneration) return;
    if (decoded.image.width !== image.width || decoded.image.height !== image.height) throw new Error('截图尺寸改变，请重新校准');
    const frame = decoded.image, b = absolute(board);
    const movement = E.motion(previous, frame, b);
    previous = frame;
    image = frame; bitmap = decoded.bitmap;
    stableFrames = movement < 0.004 ? stableFrames + 1 : 0;
    if (stableFrames >= 2 && Date.now() - lastDropAt >= config().interval * 1000) {
      if (beforeDrop && E.motion(beforeDrop, frame, b) < 0.0005) throw new Error('上次投放后棋盘没有变化，已暂停。请检查投放高度、输入响应或本局是否结束');
      overlay = analyze(frame); draw();
      if (overlay.plan.y - overlay.current.r < b.y + b.h * 0.025 ||
          overlay.fruits.some(f => f.y - f.r < b.y + b.h * 0.015)) throw new Error('水果接近校准的结束线，已暂停，请手动处理');
      await send('drop', { x: overlay.plan.x / canvas.width });
      if (!running || token !== runGeneration) return;
      dropped++; $('stats').textContent = `投放 ${dropped} 次 · 棋盘水果 ${overlay.fruits.length}`;
      beforeDrop = frame; lastDropAt = Date.now(); waitingSince = Date.now(); stableFrames = 0;
      status(`自动运行中：${overlay.plan.merge ? '优先合并同类' : '选择低位落点'}。按 Esc 可在面板中暂停。`);
    } else {
      if (Date.now() - waitingSince > 15000) throw new Error('棋盘长时间未稳定，已暂停');
      status('等待水果下落和画面稳定…');
    }
    if (running && token === runGeneration) timer = setTimeout(() => loop(token), 420);
  } catch (error) { if (token === runGeneration) await pause(error.message); }
}

action('start', async () => {
  if (running) return;
  requireCalibration(); config();
  if (!overlay || !$('verified').checked) throw new Error('请先检测预览，核对后勾选识别正确');
  await send('start', { calibration: { board, preview, dropY, view: captureView } });
  running = true; runGeneration++; mode = null; previous = null; beforeDrop = null;
  stableFrames = 0; waitingSince = Date.now(); lastDropAt = 0; $('start').disabled = true;
  for (const id of ['capture','board','preview','background','drop','inspect','threshold','radius','interval','connect']) $(id).disabled = true;
  task('自动运行中');
  loop(runGeneration);
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') void pause('已通过 Esc 暂停'); });
window.addEventListener('pagehide', () => { chrome.runtime.sendMessage({ type: 'stop' }).catch(() => {}); });
send('status').then(result => status(result.targetId ? `目标：${result.name}\n手动开始游戏后，点击“连接直播间”。` : '请返回斗鱼直播间，点击扩展图标。')).catch(error => status(error.message));
