'use strict';

// debugger 用于指定标签页截图和可信鼠标输入；不执行网页脚本、不发送网络请求。
let targetId = null;
let panelWindowId = null;
let attached = false;
let armed = false;
let calibration = null;
let busy = false;
let lastDrop = 0;
let baseline = null;
let generation = 0;

async function command(method, params = {}) {
  if (!attached || !targetId) throw new Error('请先连接直播间标签页');
  return chrome.debugger.sendCommand({ tabId: targetId }, method, params);
}

async function disarm() {
  armed = false;
  generation++;
}

async function detach() {
  await disarm();
  calibration = null;
  baseline = null;
  if (attached && targetId) {
    try { await chrome.debugger.detach({ tabId: targetId }); } catch (_) {}
  }
  attached = false;
}

chrome.action.onClicked.addListener(async tab => {
  try {
    if (!/^https:\/\/(www\.)?douyu\.com\//.test(tab.url || '')) {
      await chrome.action.setBadgeText({ tabId: tab.id, text: '斗鱼' });
      return;
    }
    if (targetId !== tab.id) await detach();
    targetId = tab.id;
    if (panelWindowId) {
      try { await chrome.windows.update(panelWindowId, { focused: true }); return; }
      catch (_) { panelWindowId = null; }
    }
    const panel = await chrome.windows.create({
      url: chrome.runtime.getURL('panel.html'), type: 'popup', width: 1080, height: 850
    });
    panelWindowId = panel.id;
  } catch (error) { console.error(error); }
});

async function ensureTarget() {
  if (!targetId) throw new Error('先在斗鱼直播间点击扩展图标');
  const tab = await chrome.tabs.get(targetId);
  const win = await chrome.windows.get(tab.windowId);
  if (!tab.active || win.state === 'minimized') {
    await disarm();
    throw new Error('直播间标签页已切走或窗口已最小化，已暂停');
  }
  if (tab.status !== 'complete') throw new Error('直播间仍在加载');
  if (!/^https:\/\/(www\.)?douyu\.com\//.test(tab.url || '')) {
    await disarm();
    throw new Error('目标已离开斗鱼页面，已暂停');
  }
  return tab;
}

function sameView(a, b) {
  return ['width', 'height', 'pageX', 'pageY'].every(k => Math.abs(a[k] - b[k]) < 1);
}

async function view() {
  const m = await command('Page.getLayoutMetrics');
  const v = m.cssVisualViewport;
  if (!v) throw new Error('浏览器未返回 CSS 视口信息');
  if (Math.abs(v.scale - 1) > 0.01) throw new Error('请关闭页面手势缩放后重新校准');
  return { width: v.clientWidth, height: v.clientHeight, pageX: v.pageX, pageY: v.pageY };
}

function validRect(r) {
  return r && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k])) &&
    r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= 1.001 && r.y + r.h <= 1.001;
}

async function handle(message) {
  switch (message.type) {
    case 'status':
      return { attached, armed, targetId, name: targetId ? (await chrome.tabs.get(targetId)).title : '' };
    case 'connect': {
      await ensureTarget();
      await disarm();
      if (!attached) {
        await chrome.debugger.attach({ tabId: targetId }, '1.3');
        attached = true;
      }
      baseline = await view();
      return { attached: true };
    }
    case 'capture': {
      await ensureTarget();
      const token = generation;
      const before = await view();
      if (armed && baseline && !sameView(before, baseline)) {
        await disarm();
        throw new Error('页面滚动或窗口尺寸改变，需重新截图校准');
      }
      const shot = await command('Page.captureScreenshot', {
        format: 'png', fromSurface: true, captureBeyondViewport: false,
        clip: { x: before.pageX, y: before.pageY, width: before.width, height: before.height, scale: 1 }
      });
      const after = await view();
      if (!sameView(before, after) || token !== generation) throw new Error('截图期间页面或连接状态改变，请重试');
      return { data: shot.data, view: after };
    }
    case 'start': {
      await ensureTarget();
      if (!attached) throw new Error('请先连接');
      const c = message.calibration;
      if (!validRect(c?.board) || !validRect(c?.preview) || !Number.isFinite(c?.dropY) ||
          c.dropY < c.board.y || c.dropY > c.board.y + c.board.h) throw new Error('校准数据不完整');
      const current = await view();
      if (!sameView(current, c.view)) throw new Error('页面已滚动或改变大小，请重新校准');
      calibration = structuredClone(c);
      baseline = current;
      generation++;
      armed = true;
      lastDrop = 0;
      return { armed: true };
    }
    case 'stop': await disarm(); return { armed: false };
    case 'disconnect': await detach(); return { attached: false };
    case 'drop': {
      if (!armed || !calibration) throw new Error('自动运行尚未启动');
      if (busy) throw new Error('上一操作尚未完成');
      if (Date.now() - lastDrop < 900) throw new Error('投放过快');
      busy = true;
      const token = generation;
      try {
        await ensureTarget();
        const current = await view();
        if (!sameView(current, baseline)) {
          await disarm();
          throw new Error('页面位置或尺寸改变，已暂停');
        }
        const b = calibration.board;
        const x = message.x;
        if (!Number.isFinite(x) || x < b.x || x > b.x + b.w) throw new Error('落点超出校准棋盘');
        if (!armed || token !== generation) throw new Error('操作已取消');
        const point = { x: x * current.width, y: calibration.dropY * current.height };
        await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        if (!armed || token !== generation) throw new Error('操作已取消');
        await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
        // 即使用户在按下后暂停，也必须释放，避免鼠标卡住。
        await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
        lastDrop = Date.now();
        return { dropped: true };
      } finally { busy = false; }
    }
    default: throw new Error('未知操作');
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html'))) return;
  handle(message).then(result => reply({ ok: true, ...result }), error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.debugger.onDetach.addListener(source => {
  if (source.tabId === targetId) { attached = false; void disarm(); }
});
chrome.tabs.onActivated.addListener(async info => {
  if (!targetId || !armed) return;
  try {
    const target = await chrome.tabs.get(targetId);
    if (target.windowId === info.windowId && info.tabId !== targetId) await disarm();
  } catch (_) { await detach(); }
});
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === targetId && (change.status === 'loading' || change.url)) void disarm();
});
chrome.tabs.onRemoved.addListener(id => {
  if (id === targetId) { attached = false; targetId = null; void disarm(); }
});
chrome.windows.onRemoved.addListener(id => {
  if (id === panelWindowId) { panelWindowId = null; void detach(); }
});
