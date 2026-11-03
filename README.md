# 斗鱼合成大西瓜助手 v0.4.0

提供 Chrome / Edge 扩展和 Tampermonkey（油猴）脚本，任选一种。使用前先停用 v0.3 及更早的助手，避免同时投放。助手默认暂停，需要手动开局和启动。

## 获取与安装

从 [v0.4.0 Release](https://github.com/Lobbyewqs/--dy/releases/tag/v0.4.0) 下载 `douyu-watermelon-helper-v0.4.0.zip` 并解压。也可点击仓库的 **Code → Download ZIP** 并解压，或克隆仓库，然后找到 `douyu-watermelon-helper-v0.4(快速投放)` 目录。该目录中的 manifest 和油猴脚本版本均为 0.4.0。

### Chrome / Edge 扩展

1. 打开 `chrome://extensions` 或 `edge://extensions`，启用“开发者模式”。manifest 要求 Chrome 118 或更新版本。
2. 点击“加载已解压的扩展程序”，选择上述 **v0.4 目录本身**，即直接包含 `manifest.json` 的目录。若使用单独提供的 `douyu-watermelon-helper-v0.4.0.zip`，先解压，再选择其中直接包含 `manifest.json` 的目录。
3. 在斗鱼直播间标签页点击扩展图标，点击“连接游戏”。手动开局后点击“开始自动”；已经开局也可直接连接，无需刷新页面。
4. 点击“暂停”“断开”或关闭助手窗口停止；面板获得焦点时也可按 Esc 暂停。使用结束后可停用扩展。

扩展使用 `activeTab` 和 `debugger` 权限读取当前直播间游戏 iframe 的场景并调用普通投放方法，浏览器会提示调试连接。打开开发者工具可能导致连接断开；重新连接后需再次手动启动。

### 油猴脚本

1. 在 Chrome / Edge 中安装并启用 Tampermonkey。
2. 打开 [v0.4 油猴脚本](douyu-watermelon-helper-v0.4%28%E5%BF%AB%E9%80%9F%E6%8A%95%E6%94%BE%29/douyu-watermelon-helper-v0.4.user.js)，在 Tampermonkey 中新建或更新脚本，粘贴完整内容并保存。
3. 允许脚本在游戏 iframe 内运行，保留 `@sandbox raw` 和 `@grant none`。下次打开游戏时加载，手动开局后点击“自动”；点击“暂停”或按 Esc 停止，游戏获得键盘焦点时可用 F8 启停。

进行中的一局不要为了安装脚本而刷新页面，刷新可能结束本局；如需连接已开始的游戏，可使用扩展方式。

## v0.4 的投放与边界

- 默认使用“动态短期预测”，不要求所有水果静止；也可选择“保守几何（快速）”。切换策略会先暂停，需要再次手动启动。
- 默认最短投放间隔 0.65 秒，面板可在启动前调整为 0.45～8 秒。实际间隔受游戏冷却、横移动画、网络、规划和可用落点影响，不保证固定速率。
- 预测考虑投放动画、短期物理和观测偏差；无法完成有效预测时使用保守几何回退，该回退未通过完整物理检查。
- 游戏隐藏、切换标签页、弹窗、道具状态、结束或断开连接时暂停。助手只控制本局普通水果投放，不自动开局、复活、购买、抽奖或重开，也不修改分数、币数、物理参数或未来队列。
- “导出”在本地保存当前棋盘、最近计划、短期轨迹和观测偏差；物理引擎随包提供，运行时无需下载依赖。

详细步骤和限制见 [v0.4 使用说明](douyu-watermelon-helper-v0.4%28%E5%BF%AB%E9%80%9F%E6%8A%95%E6%94%BE%29/%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E.md)、[策略与来源](douyu-watermelon-helper-v0.4%28%E5%BF%AB%E9%80%9F%E6%8A%95%E6%94%BE%29/%E7%AD%96%E7%95%A5%E4%B8%8E%E6%9D%A5%E6%BA%90.md) 和 [验证报告](douyu-watermelon-helper-v0.4%28%E5%BF%AB%E9%80%9F%E6%8A%95%E6%94%BE%29/%E9%AA%8C%E8%AF%81%E6%8A%A5%E5%91%8A.md)。

## 验证与复核

仓库中的验证报告记录的是本机测试和模拟浏览器结果。v0.4 尚未在真实斗鱼连续运行，也没有独立的长期得分或失败率对照；不能据模拟结果保证实际效果。游戏更新后可能需要重新适配。

安装助手不需要 Node.js。若要复核，请在已安装 Node.js 的终端进入 `douyu-watermelon-helper-v0.4(快速投放)` 目录后运行：

```powershell
node tests/run-tests.cjs
node tests/benchmark.cjs
```

基准会覆盖该目录中的 `tests/benchmark-results.json`；如需保留原文件，请先复制。结果受硬件和负载影响。

## 历史版本

[v0.3 目录](douyu-watermelon-helper-v0.3) 保留供回退；升级或回退时请先停用当前助手，避免多个版本同时运行。
