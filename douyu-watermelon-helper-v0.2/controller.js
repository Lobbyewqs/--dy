(function (root) {
  'use strict';
  class Controller {
    constructor(adapter, planner = root.WatermelonScenePlanner) {
      this.adapter = adapter; this.planner = planner; this.running = false; this.generation = 0;
      this.previous = null; this.stableFrames = 0; this.lastAt = 0; this.lastFruitId = null;
      this.round = null; this.pending = null; this.count = 0; this.waitingSince = 0; this.busy = false;
      this.interval = 1600;
    }
    async start() {
      const token = ++this.generation;
      const state = await this.adapter.start();
      if (token !== this.generation) { await this.adapter.stop(); return; }
      if (!this.planner.validState(state) || !state.visible || state.blocking || state.toolMode !== 'none' || state.toolBusy) {
        await this.adapter.stop(); throw new Error('请手动开局，关闭弹窗并退出道具状态');
      }
      this.running = true; this.round = state.round; this.previous = null; this.stableFrames = 0;
      this.lastAt = 0; this.lastFruitId = null; this.pending = null; this.count = 0; this.waitingSince = Date.now();
      return state;
    }
    async stop() { this.running = false; this.generation++; await this.adapter.stop(); }
    async tick() {
      if (this.busy) return null;
      this.busy = true;
      const token = this.generation;
      try {
        const result = await this.adapter.read();
        const state = result.state || result;
        let message = '已连接，等你启动';
        if (this.running && token === this.generation) {
          if (result.armed === false) throw new Error('标签页或连接状态改变，已暂停');
          if (!state.found || !state.visible || !state.playing || state.gameOver || state.round !== this.round) throw new Error('本局结束、切换或画面不可见，已暂停');
          if (state.blocking || state.toolBusy || state.toolMode !== 'none') throw new Error('出现弹窗或道具操作，已暂停');
          if (this.pending) {
            if (state.dropCount > this.pending.dropCount) { this.pending = null; this.count++; }
            else if (Date.now() - this.pending.at > 2500) throw new Error('正常投放没有完成，已暂停，避免重复投同一水果');
          }
          this.stableFrames = this.planner.stable(this.previous, state) ? this.stableFrames + 1 : 0;
          if (!this.pending && state.ready && state.currentFruitId !== this.lastFruitId &&
              this.stableFrames >= 2 && Date.now() - this.lastAt >= this.interval) {
            const plan = this.planner.plan(state);
            if (!plan) throw new Error('没有找到低于结束线的落点，已暂停');
            if (!this.running || token !== this.generation) return { state, message: '已暂停' };
            const accepted = await this.adapter.drop(plan);
            if (!accepted.accepted) throw new Error(accepted.reason || '游戏未接受投放');
            if (!this.running || token !== this.generation) return { state, message: '已暂停' };
            this.pending = { at: Date.now(), dropCount: state.dropCount }; this.lastFruitId = state.currentFruitId;
            this.lastAt = Date.now(); this.stableFrames = 0; this.waitingSince = Date.now();
            message = plan.merge ? `投放 ${plan.level} 级：对准同级，预计 ${plan.chain} 次合成` : `投放 ${plan.level} 级：选择较低空位`;
            this.previous = state;
            return { state, plan, message, count: this.count };
          }
          message = '等待物理场景稳定或下一水果…';
          if (Date.now() - this.waitingSince > 20000) throw new Error('等待超过 20 秒，已暂停，请检查网络、游戏状态或水果是否持续晃动');
        }
        this.previous = state;
        return { state, message, count: this.count };
      } finally { this.busy = false; }
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = Controller;
  else root.WatermelonController = Controller;
})(typeof globalThis !== 'undefined' ? globalThis : this);
