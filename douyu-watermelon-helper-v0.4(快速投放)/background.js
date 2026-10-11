'use strict';
importScripts('scene-reader.js');
let tabId = null, panelId = null, attached = false, armed = false, epoch = 0;
let contexts = new Set(), lastDrop = 0, busy = false, armedRound = null;
const send = (method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);
function stop() { armed = false; epoch++; }
async function detach() {
  stop();
  if (attached && tabId) { try { await chrome.debugger.detach({ tabId }); } catch (_) {} }
  attached = false; contexts.clear();
}
async function ensureTarget() {
  if (!tabId || !attached) throw new Error('先连接直播间');
  const tab = await chrome.tabs.get(tabId), window = await chrome.windows.get(tab.windowId);
  if (!tab.active || window.state === 'minimized' || tab.status !== 'complete') { stop(); throw new Error('直播间切走、最小化或正在加载，已暂停'); }
}
async function inScene(action, request = {}, expectedEpoch = null) {
  await ensureTarget();
  for (const contextId of Array.from(contexts)) {
    if (action === 'drop' && (!armed || epoch !== expectedEpoch)) throw new Error('已取消投放');
    try {
      const result = await send('Runtime.evaluate', {
        expression: `(${WatermelonSceneReader.run.toString()})(${JSON.stringify(action)},${JSON.stringify(request)})`,
        contextId, returnByValue: true, silent: true, timeout: 2000
      });
      if (result.exceptionDetails) continue;
      const value = result.result?.value;
      if (value?.found || value?.accepted !== undefined) return value;
    } catch (_) { contexts.delete(contextId); }
  }
  throw new Error('未找到普通合成场景。请确认游戏已打开；若刚加载，请稍后重试。');
}
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId !== tabId) return;
  if (method === 'Runtime.executionContextCreated' && params.context.auxData?.isDefault) contexts.add(params.context.id);
  if (method === 'Runtime.executionContextDestroyed') contexts.delete(params.executionContextId);
  if (method === 'Runtime.executionContextsCleared') { contexts.clear(); stop(); }
});
chrome.debugger.onDetach.addListener(source => { if (source.tabId === tabId) { attached = false; contexts.clear(); stop(); } });
chrome.action.onClicked.addListener(async tab => {
  if (!/^https:\/\/(www\.)?douyu\.com\//.test(tab.url || '')) { await chrome.action.setBadgeText({ tabId: tab.id, text: '斗鱼' }); return; }
  if (tabId !== tab.id) await detach();
  tabId = tab.id;
  if (panelId) { try { await chrome.windows.update(panelId, { focused: true }); return; } catch (_) {} }
  panelId = (await chrome.windows.create({ url: chrome.runtime.getURL('panel.html'), type: 'popup', width: 650, height: 770 })).id;
});
async function handle(m) {
  if (m.type === 'status') return { attached, armed };
  if (m.type === 'stop') { stop(); return { armed }; }
  if (m.type === 'disconnect') { await detach(); return { attached }; }
  if (m.type === 'connect') {
    if (!tabId) throw new Error('先在直播间点击扩展图标');
    stop();
    if (!attached) {
      contexts.clear(); await chrome.debugger.attach({ tabId }, '1.3'); attached = true;
      await send('Runtime.enable');
    }
    return { state: await inScene('read') };
  }
  if (m.type === 'read') return { state: await inScene('read'), armed };
  if (m.type === 'start') {
    const token = epoch;
    const state = await inScene('read');
    if (token !== epoch) throw new Error('启动已取消');
    if (!state.playing || state.gameOver || !state.visible || state.blocking || state.toolMode !== 'none' || state.toolBusy) throw new Error('请手动开局，关闭弹窗并退出道具状态');
    armedRound = state.round; stop(); armed = true; lastDrop = 0; return { state, armed };
  }
  if (m.type === 'drop') {
    if (!armed || busy) throw new Error('未运行或上次投放仍在处理中');
    if (Date.now() - lastDrop < 450) throw new Error('投放间隔过短');
    busy = true;
    const token = epoch;
    try {
      await ensureTarget();
      const state = await inScene('read');
      if (!armed || token !== epoch) throw new Error('已取消投放');
      if (state.round !== armedRound) { stop(); throw new Error('本局已改变，请重新开始助手'); }
      if (state.currentFruitId !== m.plan?.fruitId || state.round !== m.plan?.round) throw new Error('旧落点已过期，已取消');
      const result = await inScene('drop', { x: m.plan.x, fruitId: m.plan.fruitId, round: m.plan.round, guard:m.plan.guard }, token);
      if (!result.accepted) { if(result.retryable)return result; throw new Error(result.reason || '游戏拒绝投放'); }
      lastDrop = Date.now(); return result;
    } finally { busy = false; }
  }
  throw new Error('未知操作');
}
chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('panel.html'))) return;
  handle(m).then(result => reply({ ok: true, ...result }), error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onActivated.addListener(async info => {
  if (!tabId || !armed) return;
  try { const tab = await chrome.tabs.get(tabId); if (tab.windowId === info.windowId && info.tabId !== tabId) stop(); } catch (_) { await detach(); }
});
chrome.tabs.onUpdated.addListener((id, change) => { if (id === tabId && (change.status === 'loading' || change.url)) stop(); });
chrome.tabs.onRemoved.addListener(id => { if (id === tabId) { attached = false; tabId = null; contexts.clear(); stop(); } });
chrome.windows.onRemoved.addListener(id => { if (id === panelId) { panelId = null; void detach(); } });
