(function (root) {
  'use strict';

  // 该函数必须自包含：扩展将其放入游戏 iframe 的主执行环境运行。
  // 只读场景；唯一的写操作是用户启动后调用游戏正常的 dropCurrentFruitAt。
  function run(action = 'read', request = {}) {
    if (!location.pathname.startsWith('/pages/vibe-lab-act202607-game/')) return { found: false, reason: '不是合成大西瓜 iframe' };
    const canvas = document.getElementById('GameCanvas');
    if (!canvas) return { found: false, reason: '游戏画布尚未建立' };
    const sys = globalThis.System;
    let cc = globalThis.cc;
    if (!cc?.director && sys?.get) {
      try { cc = sys.get(sys.resolve('cc')); } catch (_) {}
      if (!cc?.director) { try { cc = sys.get('cc'); } catch (_) {} }
    }
    const scene = cc?.director?.getScene?.();
    if (!scene) return { found: false, reason: 'Cocos 场景尚未就绪' };
    const nodes = [scene];
    let game = null, blocking = null;
    const modal = /^(?:EndGameConfirm|GameErrorDialog|ReviveDialog|ResultDialog|ToolDialog|LotteryTenDrawConfirm)(?:Layer|Panel|Mask|Scrim)?$/;
    for (let i = 0; i < nodes.length && i < 6000; i++) {
      const node = nodes[i];
      if (!node?.isValid || !node.activeInHierarchy) continue;
      if (modal.test(node.name)) blocking = node.name;
      const components = node.getComponents(cc.Component);
      for (const c of components) {
        if (typeof c.getFruitDebugSnapshots === 'function' && typeof c.dropCurrentFruitAt === 'function' &&
            typeof c.canStartDropTouch === 'function' && c.fruits instanceof Map && c.sceneMode === 'normal') game = c;
      }
      nodes.push(...node.children);
    }
    if (!game) return { found: false, reason: '未找到普通合成场景；请手动打开合成玩法' };
    const rect = canvas.getBoundingClientRect();
    const visible = document.visibilityState === 'visible' && rect.width >= 100 && rect.height >= 100;
    const round = game.normalGameGeneration;
    const current = game.currentFruit;
    const allowed = visible && game.isPlaying && !game.gameOver && !blocking &&
      game.toolMode === 'none' && !game.toolUseInProgress && !game.pendingDrop && game.canStartDropTouch();
    if (action === 'drop') {
      if (!allowed) return { accepted: false, reason: '当前不能正常投放：隐藏、弹窗、道具、冷却或本局结束' };
      if (!current?.node?.isValid || current.id !== request.fruitId || round !== request.round) return { accepted: false, reason: '待投水果或本局已改变，放弃旧落点' };
      if (!Number.isFinite(request.x) || request.x < -game.playWidth / 2 + current.radius || request.x > game.playWidth / 2 - current.radius) return { accepted: false, reason: '落点超出物理边界' };
      if (request.guard) {
        const guard=request.guard, dt=(Date.now()-guard.at)/1000;
        if (!Number.isFinite(dt)||dt<0||dt>Math.min(400,guard.maxAgeMs||400)/1000 || !Array.isArray(guard.fruits)) return {accepted:false,retryable:true,reason:'落点快照已过期'};
        const live=game.getFruitDebugSnapshots().filter(f=>f.dropped&&!f.merging);
        const tolerance=3+650*dt*dt;
        if (live.length!==guard.fruits.length || guard.fruits.some(f=>{
          const n=live.find(n=>n.id===f.id);
          return !n||Math.hypot(n.x-f.x-(f.vx||0)*32*dt,n.y-f.y-(f.vy||0)*32*dt)>tolerance;
        }) || game.mergeQueue.length>0) return {accepted:false,retryable:true,reason:'棋盘变化，需重新规划'};
      }
      game.dropCurrentFruitAt(request.x);
      return { accepted: Boolean(game.pendingDrop), fruitId: current.id, round };
    }
    const fruits = game.getFruitDebugSnapshots().map(f => ({
      id: f.id, level: f.level, kind: f.kind, x: f.x, y: f.y,
      radius: f.radius, dropped: f.dropped, merging: f.merging, vx: f.vx, vy: f.vy, age: f.age,
      omega: Number(game.fruitsById?.get(f.id)?.body?.angularVelocity) || 0,
      awake: typeof game.fruitsById?.get(f.id)?.body?.isAwake==='function' ? game.fruitsById.get(f.id).body.isAwake() : undefined
    }));
    const radii = Array.from({ length: 11 }, (_, i) => game.getFruitRadius(i + 1));
    let explosionPowers = null;
    try {
      const core = game.getCore?.();
      if (core?.explosionLevelPower) explosionPowers = radii.map((_,i) => core.explosionLevelPower(i+1,4));
    } catch (_) {}
    return {
      found: true, visible, ready: Boolean(allowed), playing: Boolean(game.isPlaying), gameOver: Boolean(game.gameOver),
      blocking, toolMode: game.toolMode, toolBusy: Boolean(game.toolUseInProgress), pendingDrop: Boolean(game.pendingDrop),
      merging: game.mergeQueue.length > 0 || fruits.some(f => f.merging), droppingFruitId: game.droppingFruitId,
      round, dropCount: game.dropCount, score: Number(game.score) || 0, currentFruitId: current?.id ?? null,
      cooldownMs: Math.max(0,(game.nextDropAllowedAt||0)*1000-Date.now()),
      fruits, radii,
      physics: { gravity: 1300, friction: 0.2, restitution: 0.1, linearDamping: 0.12,
        angularDamping: 0.22, mergeSlop: 8, explosionPowers },
      layout: { width: game.playWidth, floor: game.getFruitFloorY(), danger: game.dangerY, top: game.playTop,
        dropY: game.dropY, visibleWidth: game.visibleWidth, visibleHeight: game.visibleHeight },
      updatedAt: Date.now()
    };
  }

  const api = { run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WatermelonSceneReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
