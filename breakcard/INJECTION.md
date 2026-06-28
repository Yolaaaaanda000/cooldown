# BreakCard × clawd-on-desk 注入清单

> 目标：在 coding agent 任务跑完（working → idle）时，弹出抽卡微健身浮窗。
> 桌宠引擎、hook 监听、透明窗口全部复用 clawd-on-desk，你只加一个浮窗 + 一个触发条件。

---

## 文件清单（已生成，放在 `clawd-on-desk/breakcard/`）

- `breakcard/breakcard.html` —— 抽卡浮窗本体（可独立在浏览器调试）
- `breakcard/breakcard-preload.js` —— 浮窗 preload，回传完成/跳过事件
- `breakcard/INJECTION.md` —— 本文件

---

## 第 0 步：先跑通原版（0:00–0:20）

```bash
cd clawd-on-desk
npm install
npm start
```

确认：螃蟹出现在桌面 + 你在某个项目里跑一次 `claude`，螃蟹会切到 working/thinking。
跑通了再往下，别在没跑通原版前改代码。

---

## 第 1 步：浮窗逻辑（main.js 顶部加一段）

在 `src/main.js` 里，文件已有 `require("electron")`，确认能拿到 `BrowserWindow` 和 `ipcMain`。
在文件靠前、其它窗口创建函数附近，粘贴下面整段：

```javascript
// ===== BreakCard 微健身抽卡 =====
const path = require("path"); // 若文件已 require 过 path 就删掉这行
let breakWin = null;
let lastWorkingStart = 0;
let lastBreakShown = 0;
const MIN_WORKING_MS   = 30 * 1000;       // working 至少持续 30s 才算"真在等"
const BREAK_COOLDOWN_MS = 15 * 60 * 1000; // 两次弹出至少间隔 15min
let userGoal = "strength";                // lose | strength | stretch，之后接 settings

function maybeShowBreakCard(prevState, nextState) {
  const now = Date.now();
  if (nextState === "working") { lastWorkingStart = now; return; }
  if (prevState === "working" && nextState === "idle") {
    const waited = now - lastWorkingStart;
    if (waited >= MIN_WORKING_MS && now - lastBreakShown >= BREAK_COOLDOWN_MS) {
      showBreakCard();
      lastBreakShown = now;
    }
  }
}

function showBreakCard() {
  if (breakWin && !breakWin.isDestroyed()) { breakWin.show(); return; }
  breakWin = new BrowserWindow({
    width: 320, height: 540,
    frame: false, transparent: true, alwaysOnTop: true,
    resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, "..", "breakcard", "breakcard-preload.js") }
  });
  breakWin.loadFile(path.join(__dirname, "..", "breakcard", "breakcard.html"));
  breakWin.webContents.on("did-finish-load", () => {
    breakWin.webContents.executeJavaScript(
      `window.breakcardSetGoal && breakcardSetGoal("${userGoal}");`
    );
  });
}

const { ipcMain: _bcIpc } = require("electron"); // 若已 require ipcMain 就用现成的
_bcIpc.on("breakcard-event", (_e, event) => {
  if (breakWin && !breakWin.isDestroyed()) breakWin.close();
  breakWin = null;
  // 完成时让螃蟹开心一下：复用它现有的 "attention" 状态（庆祝动画）
  // 找到你项目里触发状态的入口（见第 2 步），调一次 setState("attention")
});
```

> ⚠️ 注意：`path` / `ipcMain` 可能 main.js 顶部已经 require 过。
> 跑起来若报 "Identifier already declared"，把重复的 require 删掉即可。

---

## 第 2 步：挂触发点 —— 真实变量名已对好，直接抄

clawd-on-desk 用的真实结构（已确认）：
- `src/main.js:1478` —— `const _state = require("./state")(_stateCtx);`
- `_stateCtx` 是上面一大段对象字面量，以 `};`（1477 行附近）结尾
- `src/state.js:424` —— `function setState(newState, svgOverride, options = {})`，所有状态变更总闸
- state.js 内部用 `ctx` 引用传进来的 `_stateCtx`

### 2a. main.js：在 `_stateCtx` 对象里加一个回调

找到 1477 行那个 `};`（`_stateCtx` 的结尾），在它**前面**加一行（注意前面要有逗号）：

```javascript
  hasAnyEnabledAgent: () => {
    // ...原有代码
    return false;
  },
  onStateTransition: (prev, next) => maybeShowBreakCard(prev, next),  // ← 新增这行
};
const _state = require("./state")(_stateCtx);
```

### 2b. state.js：在 setState 第一行报告跳变

`src/state.js:424`，在 `if (shouldDropForDnd()) return;` **之前**插入：

```javascript
function setState(newState, svgOverride, options = {}) {
  // ↓↓↓ 新增
  try {
    if (typeof ctx.onStateTransition === "function") {
      ctx.onStateTransition(currentState, newState);
    }
  } catch (e) {}
  // ↑↑↑
  if (shouldDropForDnd()) return;
  // ...原有代码不动
```

> 接通完成。`currentState`=上一个状态，`newState`=将要变成的状态，working→idle 正好命中。

---

## 第 3 步：完成时让螃蟹比心 —— 几乎零工作

好消息：main.js 第 **1480** 行已经把 `setState` 从 `_state` 解构出来了：
```javascript
const { setState, applyState, updateSession, ... } = _state;
```
所以第 1 步的 ipc 回调里直接用现成的 `setState` 即可，把那段补完整：

```javascript
_bcIpc.on("breakcard-event", (_e, event) => {
  if (breakWin && !breakWin.isDestroyed()) breakWin.close();
  breakWin = null;
  if (event === "workout_done") {
    setState("attention");   // 复用现成的庆祝/比心动画，让螃蟹开心
  }
});
```

> ⚠️ 顺序提醒：`_bcIpc.on(...)` 这段要放在 1480 行 `setState` 解构**之后**，
> 否则引用不到。建议把第 1 步那整段（含 ipc）挪到 1481 行之后粘贴。

---

## Demo flow（3:20–4:00 排练）

1. 打开一个项目，`claude` 跑一个要 30s+ 的任务（比如让它读一个大文件 + 改）
2. 螃蟹切 working（讲解：它在监听真实 hook）
3. 任务完成 → 螃蟹庆祝回 idle → **抽卡浮窗自动弹出**
4. 抽一张 → 翻牌出动作 → 开始 5 分钟（demo 时 DURATION 改 10 秒）
5. 完成 → 浮窗关闭 → 螃蟹比心

**一句话 pitch**：别的桌宠在你等 agent 时卖萌，这个让你把等待变成微健身。

---

## 调试速查

- 浮窗不弹：把 `MIN_WORKING_MS` 临时改成 0、`BREAK_COOLDOWN_MS` 改成 0
- 想手动测浮窗：在 main.js 临时加 `setTimeout(showBreakCard, 5000)`
- 倒计时太长：breakcard.html 里 `const DURATION = 10`
- 浮窗位置：showBreakCard 里 BrowserWindow 加 `x, y`（默认屏幕中间）
- 换你的小螃蟹素材：替换 `themes/clawd/` 下的动画文件，状态名对齐
  （idle/working/thinking/attention/...，见 themes/clawd/theme.json）
