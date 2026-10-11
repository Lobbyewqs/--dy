(function(root){
  'use strict';
  const defaultPlanner=typeof module!=='undefined'&&module.exports?require('./scene-planner.js'):root.WatermelonScenePlanner;
  class Controller {
    constructor(adapter,planner=defaultPlanner){
      this.adapter=adapter;this.planner=planner;this.running=false;this.generation=0;this.busy=false;
      this.previous=null;this.round=null;this.pending=null;this.count=0;this.lastAt=0;this.lastFruitId=null;
      this.interval=650;this.waitingSince=0;this.mode='dynamic';
      this.watch=null;this.modelError=null;this.errorSamples=0;
    }
    async start(){
      const token=++this.generation,state=await this.adapter.start();
      if(token!==this.generation){await this.adapter.stop();return;}
      if(!this.planner.validState(state)||!state.visible||state.blocking||state.toolMode!=='none'||state.toolBusy){
        await this.adapter.stop();throw new Error('请手动开局，关闭弹窗并退出道具状态');
      }
      this.running=true;this.round=state.round;this.previous=null;this.pending=null;this.count=0;
      this.lastAt=0;this.lastFruitId=null;this.waitingSince=Date.now();this.watch=null;
      this.modelError=null;this.errorSamples=0;return state;
    }
    async stop(){this.running=false;this.generation++;this.watch=null;await this.adapter.stop();}
    check(state,result){
      if(result.armed===false)throw new Error('标签页或连接状态改变，已暂停');
      if(!this.planner.validState(state)||!state.visible||state.round!==this.round)throw new Error('本局结束、切换或画面不可见，已暂停');
      if(state.blocking||state.toolBusy||state.toolMode!=='none')throw new Error('出现弹窗或道具操作，已暂停');
    }
    observe(state){
      const watch=this.watch;if(!watch)return;
      const t=((state.updatedAt??Date.now())-watch.prediction.at)/1000;
      if(t<0||t>2.5){this.watch=null;return;}
      const errors=[];
      function interpolate(frames,get){
        if(!frames?.length||t<frames[0].t-0.001||t>frames[frames.length-1].t+0.001)return null;
        const right=frames.findIndex(f=>f.t>=t),i=right<0?frames.length-1:right;
        const a=frames[Math.max(0,i-1)],b=frames[i],pa=get(a),pb=get(b);
        if(!pa||!pb)return null;const u=a.t===b.t?0:(t-a.t)/(b.t-a.t);
        return {x:pa.x+(pb.x-pa.x)*u,y:pa.y+(pb.y-pa.y)*u};
      }
      for(const actual of state.fruits.filter(f=>f.dropped&&!f.merging)){
        const prediction=actual.id===watch.fruitId?interpolate(watch.prediction.trace,f=>f):
          interpolate(watch.prediction.forecast,f=>f.fruits.find(p=>p.id===actual.id));
        if(prediction)errors.push(Math.hypot(actual.x-prediction.x,actual.y-prediction.y));
      }
      if(errors.length&&t-watch.lastSample>=0.12){
        const error=Math.min(120,Math.max(...errors));
        this.modelError=this.modelError===null?error:0.75*this.modelError+0.25*error;
        this.errorSamples++;watch.lastSample=t;
      }
    }
    async tick(){
      if(this.busy)return null;this.busy=true;const token=this.generation;
      try{
        const result=await this.adapter.read(),state=result.state||result;
        if(!this.running||token!==this.generation)return {state,message:'已连接，等你启动',count:this.count};
        this.check(state,result);this.observe(state);
        if(this.pending){
          if(state.dropCount>this.pending.dropCount){this.pending=null;this.count++;this.waitingSince=Date.now();}
          else if(Date.now()-this.pending.at>2500)throw new Error('正常投放没有完成，已暂停，避免重复投同一水果');
        }
        let message='等待游戏允许下一次投放…';
        if(!this.pending&&this.planner.eligible(state)&&state.currentFruitId!==this.lastFruitId&&Date.now()-this.lastAt>=this.interval){
          const modelTrust=this.modelError===null?0.65:Math.max(0.15,0.65/(1+this.modelError/12));
          const plan=await (this.planner.planAsync||this.planner.plan)(state,{
            mode:this.mode==='greedy'?'greedy':'dynamic',modelTrust,isCancelled:()=>!this.running||token!==this.generation});
          if(!this.running||token!==this.generation)return {state,message:'已暂停'};
          if(!plan)throw new Error('没有找到可投放的低风险落点，已暂停');
          const freshResult=await this.adapter.read(),fresh=freshResult.state||freshResult;
          if(!this.running||token!==this.generation)return {state:fresh,message:'已暂停'};
          this.check(fresh,freshResult);
          if(!this.planner.compatible(state,fresh)){
            this.previous=fresh;return {state:fresh,message:'棋盘发生新变化，下一帧重算…'};
          }
          plan.guard=this.planner.guard(fresh);
          const accepted=await this.adapter.drop(plan);
          if(!accepted.accepted){
            if(accepted.retryable)return {state:fresh,message:'落点已过期，下一帧重算…'};
            throw new Error(accepted.reason||'游戏未接受投放');
          }
          if(!this.running||token!==this.generation)return {state:fresh,message:'已暂停'};
          this.pending={at:Date.now(),dropCount:fresh.dropCount};this.lastFruitId=plan.fruitId;this.lastAt=Date.now();
          this.waitingSince=Date.now();this.watch=plan.prediction?{fruitId:plan.fruitId,prediction:plan.prediction,lastSample:-1}:null;
          message=plan.diagnostics?.fallback?'已投放：保守几何落点':`已投放：短期推演 ${plan.diagnostics.simulations} 次 · ${plan.diagnostics.elapsedMs} ms`;
          this.previous=fresh;return {state:fresh,plan,message,count:this.count,modelError:this.modelError,errorSamples:this.errorSamples};
        }
        if(state.ready&&state.merging)message='合成队列处理中，稍后重算…';
        if(Date.now()-this.waitingSince>30000&&!state.ready)throw new Error('游戏持续 30 秒未就绪，已暂停，请检查游戏或网络');
        this.previous=state;return {state,message,count:this.count,modelError:this.modelError,errorSamples:this.errorSamples};
      }finally{this.busy=false;}
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports=Controller;
  else root.WatermelonController=Controller;
})(typeof globalThis!=='undefined'?globalThis:this);
