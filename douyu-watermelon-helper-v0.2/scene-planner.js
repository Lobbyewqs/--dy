(function (root) {
  'use strict';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const validFruit = f => f && Number.isInteger(f.level) && f.level >= 1 && f.level <= 11 &&
    ['x', 'y', 'radius'].every(k => Number.isFinite(f[k])) && f.radius > 0;
  const mergeable = (a, b) => a.kind === 'normal' && b.kind === 'normal' && a.level === b.level && a.level < 11;

  function validState(s) {
    return s?.found && s.playing && !s.gameOver && s.layout && ['width', 'floor', 'danger', 'top'].every(k => Number.isFinite(s.layout[k])) &&
      s.layout.width > 0 && s.layout.danger > s.layout.floor && s.layout.top >= s.layout.danger && Array.isArray(s.fruits) &&
      Array.isArray(s.radii) && s.radii.length === 11 && s.radii.every(r => Number.isFinite(r) && r > 0) && s.fruits.every(validFruit);
  }

  function landing(s, x, current, fruits) {
    let y = s.layout.floor + current.radius, hit = null;
    for (const f of fruits) {
      const dx = Math.abs(x - f.x), sum = current.radius + f.radius;
      if (dx >= sum) continue;
      const contactY = f.y + Math.sqrt(Math.max(0, sum * sum - dx * dx));
      if (contactY > y) { y = contactY; hit = f; }
    }
    return { y, hit };
  }

  function predictMerge(s, current, hit, fruits) {
    if (!hit || !mergeable(current, hit)) return { chain: 0, resulting: null };
    let chain = 1, level = current.level + 1;
    let radius = s.radii[level - 1];
    let x = clamp(hit.x, -s.layout.width / 2 + radius, s.layout.width / 2 - radius);
    let y = Math.max(hit.y, s.layout.floor + radius);
    const remaining = fruits.filter(f => f.id !== hit.id);
    // 按源代码使用较低水果的位置作为合成中心，近邻连锁仍是近似推测。
    while (chain < 4 && level < 11) {
      const index = remaining.findIndex(f => f.kind === 'normal' && f.level === level &&
        Math.hypot(f.x - x, f.y - y) <= f.radius + radius + 4);
      if (index < 0) break;
      const other = remaining.splice(index, 1)[0];
      if (other.y < y) { x = other.x; y = other.y; }
      level++; chain++; radius = s.radii[level - 1];
      x = clamp(x, -s.layout.width / 2 + radius, s.layout.width / 2 - radius);
      y = Math.max(y, s.layout.floor + radius);
    }
    return { chain, resulting: { x, y, radius, level } };
  }

  function plan(s) {
    if (!validState(s)) return null;
    const current = s.fruits.find(f => f.id === s.currentFruitId && !f.dropped && !f.merging);
    if (!current || current.kind !== 'normal') return null;
    const fruits = s.fruits.filter(f => f.dropped && !f.merging && f.id !== current.id);
    const left = -s.layout.width / 2 + current.radius + 1, right = s.layout.width / 2 - current.radius - 1;
    if (left >= right) return null;
    const xs = Array.from({ length: 41 }, (_, i) => left + (right - left) * i / 40);
    xs.push(clamp(0, left, right));
    for (const f of fruits) {
      xs.push(clamp(f.x, left, right));
      const offset = f.radius + current.radius + 1;
      xs.push(clamp(f.x - offset, left, right), clamp(f.x + offset, left, right));
    }
    const height = s.layout.danger - s.layout.floor;
    const choices = [];
    for (const x of new Set(xs.map(x => Math.round(x * 10) / 10))) {
      if (x < left || x > right) continue;
      const impact = landing(s, x, current, fruits);
      const alignment = impact.hit ? 1 - Math.abs(x - impact.hit.x) / (current.radius + impact.hit.radius) : 0;
      const merge = Boolean(impact.hit && mergeable(current, impact.hit) && alignment >= 0.25);
      const prediction = merge ? predictMerge(s, current, impact.hit, fruits) : { chain: 0, resulting: null };
      const top = prediction.resulting ? prediction.resulting.y + prediction.resulting.radius : impact.y + current.radius;
      const risk = clamp((top - s.layout.floor) / height, 0, 2);
      const safe = top < s.layout.danger - Math.max(3, current.radius * 0.15);
      let score = -risk * 65 - (safe ? 0 : 1000);
      if (merge) score += (120 + current.level * 5) * (0.6 + alignment * 0.4) + (prediction.chain - 1) * 70;
      else {
        // 让同级水果靠近，但不能因此穿过上层水果。
        const peers = fruits.filter(f => mergeable(f, current));
        if (peers.length) score += 6 * Math.max(...peers.map(f => 1 - Math.min(1, Math.abs(f.x - x) / s.layout.width)));
      }
      score -= Math.abs(x) / s.layout.width;
      choices.push({ x, y: impact.y, score, safe, merge, chain: prediction.chain, level: current.level,
        fruitId: current.id, round: s.round, hitId: impact.hit?.id ?? null, resulting: prediction.resulting });
    }
    choices.sort((a, b) => b.score - a.score);
    return choices.find(c => c.safe) || null;
  }

  function stable(previous, current) {
    if (!validState(current) || current.pendingDrop || current.merging || current.droppingFruitId !== null) return false;
    if (!previous || previous.round !== current.round || previous.currentFruitId !== current.currentFruitId) return false;
    const dropped = current.fruits.filter(f => f.dropped);
    const old = previous.fruits.filter(f => f.dropped);
    if (dropped.length !== old.length) return false;
    return dropped.every(f => {
      const p = old.find(p => p.id === f.id);
      return p && !f.merging && Math.hypot(f.vx || 0, f.vy || 0) < 1 && Math.hypot(f.x - p.x, f.y - p.y) < 0.6;
    });
  }
  const api = { plan, stable, validState, landing, mergeable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WatermelonScenePlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
