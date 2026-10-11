(function (root) {
  'use strict';
  const pl = typeof module !== 'undefined' && module.exports ? require('./vendor/planck.min.js') : root.WatermelonPlanck;
  const SCALE = 32, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mergeable = (a, b) => a.kind === 'normal' && b.kind === 'normal' && a.level === b.level && a.level < 11;
  const credit = level => 18 + level * 9 + level * level;

  // 独立世界内预测，绝不 step 或修改网页中的实际物理世界。
  function simulate(state, level, x, options = {}) {
    if (!pl?.World) throw new Error('本地物理预测库没有加载');
    const layout = state.layout, p = state.physics || {}, dt = 1 / 120;
    const radius = state.radii[level - 1], half = layout.width / 2;
    if (!Number.isFinite(radius) || radius <= 0 || radius * 2 >= layout.width || !Number.isFinite(x)) return null;
    x = clamp(x, -half + radius, half - radius);
    const world = new pl.World(pl.Vec2(0, -(p.gravity ?? 1300) / SCALE));
    // 预测采用小步长离散碰撞，避免合成后深度重叠触发昂贵的 TOI 求解。
    // 基准执行环境可显式打开 CCD，以检验这一近似造成的误差。
    world.setContinuousPhysics(options.continuous === true);
    const wall = world.createBody();
    const fixture = { friction: p.friction ?? 0.2, restitution: p.restitution ?? 0.1 };
    wall.createFixture(pl.Edge(pl.Vec2(-half/SCALE, layout.floor/SCALE), pl.Vec2(half/SCALE, layout.floor/SCALE)), fixture);
    wall.createFixture(pl.Edge(pl.Vec2(-half/SCALE, layout.floor/SCALE), pl.Vec2(-half/SCALE, (layout.top + 600)/SCALE)), fixture);
    wall.createFixture(pl.Edge(pl.Vec2(half/SCALE, layout.floor/SCALE), pl.Vec2(half/SCALE, (layout.top + 600)/SCALE)), fixture);
    let seq = Math.max(0, ...state.fruits.map(f => Number(f.id) || 0)) + 1;
    const live = new Map(), contacts = [];
    let time = 0, lastMerge = -1, gain = 0, chain = 0, mergeCount = 0, hitId = null, overTime = 0, dead = false;
    let incoming = null, firstContact = null;
    const trace = [], forecast = [];
    const releaseDelay = options.releaseDelay ?? 0;
    function add(f, line, age = 2) {
      const data = { id: f.id, level: f.level, kind: f.kind || 'normal', radius: f.radius, line, born: time - age };
      const body = world.createDynamicBody({
        position: pl.Vec2(f.x/SCALE, f.y/SCALE), linearVelocity: pl.Vec2(f.vx || 0, f.vy || 0),
        angularVelocity: f.omega || 0, linearDamping: p.linearDamping ?? 0.12,
        angularDamping: p.angularDamping ?? 0.22, bullet: true, allowSleep: true, userData: data
      });
      body.createFixture(pl.Circle(f.radius/SCALE), { ...fixture, density: 1 });
      data.body = body; live.set(data.id, data);
      // 速度为零可能只是抛物线顶点，不能据此把悬空水果设置为休眠。
      if (f.awake === false) body.setAwake(false);
      return data;
    }
    for (const f of state.fruits) if (f.dropped && !f.merging) add(f, false, f.age ?? 2);
    function release() {
      incoming = add({ id: seq++, level, kind: 'normal', radius, x,
        y: Number.isFinite(layout.dropY) ? layout.dropY : layout.top + radius, vx: 0, vy: 0 }, true, 0);
    }
    if (releaseDelay <= 0 && !options.noDrop) release();
    function contactOf(a,b) {
      if (firstContact || !incoming || (a !== incoming && b !== incoming)) return;
      const other = a === incoming ? b : a, pos = incoming.body.getPosition();
      firstContact = { id:other?.id ?? null, level:other?.level ?? null, x:pos.x*SCALE,
        y:pos.y*SCALE, time, merge:Boolean(other && mergeable(incoming,other)) };
    }
    world.on('begin-contact', contact => {
      const a = contact.getFixtureA().getBody().getUserData(), b = contact.getFixtureB().getBody().getUserData();
      contactOf(a,b);
      if (a && b && mergeable(a, b)) contacts.push([Math.min(a.id, b.id), Math.max(a.id, b.id)]);
    });
    function merge(a, b) {
      if (!live.has(a.id) || !live.has(b.id) || !mergeable(a, b)) return;
      contactOf(a,b);
      const ap = a.body.getPosition(), bp = b.body.getPosition();
      const low = ap.y <= bp.y ? a : b, pos = low.body.getPosition(), nextLevel = a.level + 1;
      const r = state.radii[nextLevel - 1], line = a.line || b.line, omega = low.body.getAngularVelocity() * 0.2;
      const nx = clamp(pos.x*SCALE, -half + r, half - r);
      const ny = Math.max(layout.floor + r, Math.min(layout.top - r, pos.y*SCALE));
      if (line) { chain++; if (hitId === null) hitId = a.line ? b.id : a.id; }
      world.destroyBody(a.body); world.destroyBody(b.body); live.delete(a.id); live.delete(b.id);
      const merged = add({ id: seq++, level: nextLevel, radius: r, x: nx, y: ny, omega }, line, 0);
      gain += credit(nextLevel); mergeCount++; lastMerge = time;
      const power = p.explosionPowers?.[nextLevel-1] ?? Math.max(0, nextLevel - 4);
      const reach = 240 + 42 * power + 0.45 * r, strength = 3 + power;
      for (const other of live.values()) {
        if (other === merged) continue;
        const op = other.body.getPosition(), dx = op.x*SCALE - nx, dy = op.y*SCALE - ny, distance = Math.hypot(dx, dy);
        const edge = Math.max(0, distance - 0.45 * other.radius);
        if (edge > reach) continue;
        const magnitude = strength * (1 - edge/reach) ** 2;
        const direction = distance > 0.001 ? dx/distance : (other.id%2 === 0 ? 1 : -1);
        const velocity = other.body.getLinearVelocity();
        let vx=velocity.x+direction*magnitude, vy=velocity.y+(distance>0.001?dy/distance:0)*magnitude+magnitude*0.22;
        const speed=Math.hypot(vx,vy), cap=p.explosionVelocityCap ?? 1800;
        if(speed>cap){vx*=cap/speed;vy*=cap/speed;}
        other.body.setLinearVelocity(pl.Vec2(vx,vy));
        other.body.setAngularVelocity(other.body.getAngularVelocity() + (direction >= 0 ? -1 : 1)*magnitude*0.035);
        other.body.setAwake(true);
      }
    }
    const steps = Math.ceil((options.seconds ?? 3.8) / dt);
    let settled = false, calmFrames = 0, truncated = false;
    const deadline=performance.now()+(options.maxMs ?? 80);
    for (let step = 0; step < steps; step++) {
      if(performance.now()>deadline){truncated=true;break;}
      if (!incoming && !options.noDrop && time >= releaseDelay) release();
      world.step(dt, options.accurate ? 18 : 8, options.accurate ? 24 : 6); time += dt;
      const queued = contacts.splice(0).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
      for (const [a,b] of queued) if (live.has(a) && live.has(b)) merge(live.get(a), live.get(b));
      if (step % 6 === 0) {
        const list = [...live.values()].sort((a,b) => a.id-b.id);
        for (let i=0; i<list.length; i++) for (let j=i+1; j<list.length; j++) {
          const a=list[i], b=list[j];
          if (!live.has(a.id) || !live.has(b.id) || !mergeable(a,b)) continue;
          const ap=a.body.getPosition(), bp=b.body.getPosition();
          if (Math.hypot(ap.x-bp.x, ap.y-bp.y)*SCALE <= a.radius+b.radius+(p.mergeSlop ?? 8)) merge(a,b);
        }
      }
      if (options.capture && step % 8 === 0) {
        if (incoming && live.has(incoming.id)) {
          const pos=incoming.body.getPosition();trace.push({t:time,x:pos.x*SCALE,y:pos.y*SCALE});
        }
        forecast.push({t:time,fruits:[...live.values()].filter(f=>!f.line).map(f=>{
          const pos=f.body.getPosition();return {id:f.id,x:pos.x*SCALE,y:pos.y*SCALE};
        })});
      }
      if (options.afterContact !== undefined && firstContact && time-firstContact.time>=options.afterContact) break;
      let moving = false, above = false;
      for (const f of live.values()) {
        const v=f.body.getLinearVelocity(), speed=Math.hypot(v.x,v.y), top=f.body.getPosition().y*SCALE+f.radius;
        if (speed > 0.06 || Math.abs(f.body.getAngularVelocity()) > 0.1) moving=true;
        if (time-f.born > 0.8 && top > layout.danger && speed < 0.06) above=true;
      }
      overTime=above ? overTime+dt : 0;
      if (overTime >= 0.8) { dead=true; break; }
      calmFrames = !moving && time-lastMerge > 0.45 ? calmFrames+1 : 0;
      if (incoming && time > releaseDelay+0.65 && calmFrames >= 24) { settled=true; break; }
    }
    const fruits = [...live.values()].map(f => {
      const pos=f.body.getPosition(), v=f.body.getLinearVelocity();
      return { id:f.id,level:f.level,kind:f.kind,x:pos.x*SCALE,y:pos.y*SCALE,radius:f.radius,
        vx:v.x,vy:v.y,omega:f.body.getAngularVelocity(),age:time-f.born,dropped:true,merging:false,line:f.line };
    });
    const maxTop=Math.max(layout.floor,...fruits.map(f=>f.y+f.radius));
    const margin=Math.max(4, radius*0.12);
    return { fruits, gain, chain, mergeCount, hitId, dead, settled, truncated, maxTop, simulatedSeconds:time,
      firstContact, trace, forecast, releaseDelay,
      safe:!truncated && !dead && maxTop < layout.danger-margin, resulting:fruits.find(f=>f.line) || null };
  }
  const api={ simulate, mergeable, credit, SCALE };
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.WatermelonPhysicsModel=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
