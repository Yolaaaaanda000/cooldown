# BreakCard 🦀

> 在你等 coding agent 跑完的间隙，桌宠递给你一张运动卡——抽一张，动 5 分钟。
> 别的桌宠在你等的时候卖萌，这个把等待变成微健身。

基于开源桌宠 [clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) 扩展：
它负责桌宠 + 监听 Claude Code / Codex 的 hook + 透明窗口；
我们负责把「任务完成的那一刻」变成一次抽卡微健身。

---

## 目录分工（重要：避免互相撞车）

```
breakcard/        ← 引擎实现（Yolanda）
  breakcard.html        抽卡浮窗本体
  breakcard-preload.js  浮窗与主进程通信
  INJECTION.md          如何接进 clawd-on-desk 的施工图
design/           ← 设计与内容（Claire）
  moves.json            动作库 / 文案 / 目标分类（引擎只读这个）
  README.md             给 Claire 的字段说明 ← 先看这个
  interaction-spec.md   交互方案（Claire 新建）
```

**规则：Claire 只改 `design/`，Yolanda 改 `breakcard/`。** 改 json 内容不用对齐，改卡片结构要先对一下。

---

## 怎么跑

这个仓库本身**不是一个能独立运行的 app**，它是叠加在 clawd-on-desk 上的扩展。

1. clone 官方桌宠：`git clone https://github.com/rullerzhou-afk/clawd-on-desk.git`
2. 把本仓库的 `breakcard/` 和 `design/` 两个目录复制进 `clawd-on-desk/` 根目录下
3. 按 `breakcard/INJECTION.md` 做三处注入
4. `cd clawd-on-desk && npm install && npm start`

### 只想看抽卡浮窗效果（不跑桌宠）

`design/` 和 `breakcard/` 放好后，在仓库根目录起个本地服务器再开页面（直接双击 HTML 会因为浏览器安全限制读不到 moves.json）：
```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/breakcard/breakcard.html
```

---

## ⚠️ 许可注意（影响以后能不能商用）

clawd-on-desk 的源码是 **AGPL** 协议（传染性很强）。
所以我们**不 fork 它、不把它的源码搬进本仓库**，只把它当运行依赖。
本仓库里只放我们自己写的 `breakcard/` 和 `design/`，许可我们自己定。
这样以后想商用、想脱离它独立，IP 是干净的。

---

## 现在的边界（v0 故意不做的）

- ❌ 不记录任何健身数据（隐私 + 还没到那一步，见 design/README.md）
- ❌ 不接屏幕使用时间统计（先验证「人会不会动」）
- ✅ 只做：working→idle 时弹卡 → 抽卡 → 5 分钟计时 → 螃蟹比心

验证了核心假设再往上加。
