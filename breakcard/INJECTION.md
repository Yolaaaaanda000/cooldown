# BreakCard × clawd-on-desk 注入清单

> 目标：agent 持续忙（thinking/working）一段时间还没停时，弹出抽卡微健身浮窗；做完让螃蟹比心。
> 桌宠引擎、hook 监听、透明窗口全部复用 clawd-on-desk，你只加一个浮窗 + 一个触发条件。

> ⚠️ 本文件是**唯一被提交的注入记录**——真正改过的 `src/main.js` / `src/state.js` 在 gitignore 的 clawd-on-desk 里，不入库。按这份能复现。

---

## 目录约定（本仓库 = 叠加在 clawd-on-desk 上的扩展层）

推荐用**软链接**（而非复制）把本仓库的 `breakcard/`、`design/` 接进 clawd-on-desk，这样引擎直接跑提交源、不产生「副本 vs 源」漂移：

```bash
cd clawd-on-desk
rm -rf breakcard design
ln -s ../breakcard breakcard   # 若 clawd-on-desk 不在本仓库内，换成绝对路径
ln -s ../design  design
```

## 文件清单
- `breakcard/breakcard.html` —— 抽卡浮窗（可拖动 / ✕ 关闭 / 透明悬浮；倒计时读 `design/moves.json` 的 `config.durationSec`）
- `breakcard/breakcard-preload.js` —— 浮窗 preload，回传完成/跳过事件
- `design/triggers.json` —— 弹卡时机（引擎读取，Claire 可改）
- `breakcard/INJECTION.md` —— 本文件

---

## 第 0 步：先跑通原版

```bash
cd clawd-on-desk
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"   # 国内镜像，可选
npm install
export CLAWD_SKIP_SIDECAR_FETCH=1   # 跳过用不到的 Telegram 远程审批 sidecar
npm start
```
确认：螃蟹出现在桌面，跑一次 `claude` 时螃蟹切到 thinking / working。跑通了再注入。

---

## 第 1 步：浮窗逻辑（main.js）

`src/main.js:1` 已从 electron 解构出 `BrowserWindow / ipcMain / screen`，`:70` 已 `require("path")`——**不要重复 require**。
在 setState 解构之后（`const sessions = _state.sessions;` 那行附近）粘贴整段：

```javascript
// ===== BreakCard 微健身抽卡 =====
// 注：path 已在文件顶部 require（~line 70），BrowserWindow / ipcMain 已在顶部从 electron 解构（line 1），此处不再重复 require。
const { powerMonitor } = require("electron"); // 系统空闲时长：判断你是不是真停下来了
let breakWin = null;
let lastBreakShown = 0;
let busyStart = 0;      // 本轮“忙”的起点
let busyPoll = null;    // 忙碌期间的轮询句柄
const BUSY_STATES = new Set(["thinking", "working"]); // Claude 的忙碌态是 thinking/working
let userGoal = "strength";              // lose | strength | stretch，之后接 settings

// ===== 弹卡时机：读 design/triggers.json（Claire 拥有的配置），失败则用默认值 =====
let _bc = { minBusySec: 75, idleSec: 15, cooldownMin: 40, activeHours: { start: 8, end: 22 }, skipDuringStates: ["notification", "error", "sleeping"], enabled: true };
try {
  const _t = JSON.parse(require("fs").readFileSync(path.join(__dirname, "..", "design", "triggers.json"), "utf8"));
  _bc = { ..._bc, ...((_t.interventions && _t.interventions.breakcard) || {}) };
} catch (e) { console.warn("[breakcard] triggers.json 读取失败，用默认值:", e.message); }
const MIN_BUSY_MS       = (_bc.minBusySec ?? 75) * 1000;        // agent 连续忙这么久才算“真长任务”
const IDLE_SEC          = _bc.idleSec ?? 15;                    // 你输入静止这么久才算“真停下来在干等”
const BREAK_COOLDOWN_MS = (_bc.cooldownMin ?? 40) * 60 * 1000;  // 两次弹出至少间隔
const ACTIVE_START      = (_bc.activeHours && _bc.activeHours.start) ?? 8;  // 只在活跃时段弹
const ACTIVE_END        = (_bc.activeHours && _bc.activeHours.end) ?? 22;
const SKIP_STATES       = new Set(_bc.skipDuringStates || []);  // 这些状态下不弹（该你处理，不是运动时机）
const BC_ENABLED        = _bc.enabled !== false;

function withinActiveHours() {
  const h = new Date().getHours();
  return ACTIVE_START <= ACTIVE_END ? (h >= ACTIVE_START && h < ACTIVE_END)
                                    : (h >= ACTIVE_START || h < ACTIVE_END); // 跨午夜
}

// 真等待 = agent 持续忙够 && 你输入静止够（真停下来）&& 活跃时段 && 过冷却。任一不满足就继续等。
function tryPopBreakCard() {
  if (breakWin && !breakWin.isDestroyed()) return;             // 卡已开着
  const now = Date.now();
  if (now - busyStart < MIN_BUSY_MS) return;                   // 还没忙够
  if (now - lastBreakShown < BREAK_COOLDOWN_MS) return;        // 冷却中
  if (!withinActiveHours()) return;                            // 非活跃时段
  if (powerMonitor.getSystemIdleTime() < IDLE_SEC) return;     // 你还在动，没真停下来（可能在盯着读）
  showBreakCard();
  lastBreakShown = now;
  stopBusyWatch();                                            // 弹了就停轮询
}

function startBusyWatch() {
  if (busyPoll) return;                                       // 已在盯
  busyStart = Date.now();
  busyPoll = setInterval(tryPopBreakCard, 3000);             // 忙碌期间每 3s 检查一次条件
}
function stopBusyWatch() {
  if (busyPoll) { clearInterval(busyPoll); busyPoll = null; }
}

function maybeShowBreakCard(prevState, nextState) {
  if (!BC_ENABLED) return;
  if (SKIP_STATES.has(nextState)) { stopBusyWatch(); return; }  // 权限/报错/离开：这不是等待，停
  if (BUSY_STATES.has(nextState)) { startBusyWatch(); return; } // 进入忙碌：开始盯条件
  if (nextState === "idle") { stopBusyWatch(); }                // 真闲下来：这轮等待结束
  // attention 等其它中间态：不动，继续盯
}

function showBreakCard() {
  if (breakWin && !breakWin.isDestroyed()) { breakWin.show(); return; }
  const winW = 320, winH = 540, margin = 24;
  const { workArea } = screen.getPrimaryDisplay(); // 贴右侧、垂直居中，不挡屏幕中央
  breakWin = new BrowserWindow({
    width: winW, height: winH,
    x: workArea.x + workArea.width - winW - margin,
    y: workArea.y + Math.round((workArea.height - winH) / 2),
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
  breakWin.on("closed", () => { breakWin = null; }); // 任何方式关闭都复位引用
}

ipcMain.on("breakcard-event", (_e, event) => {
  if (breakWin && !breakWin.isDestroyed()) breakWin.close();
  breakWin = null;
  if (event === "workout_done") {
    setState("love");   // 专属比心动画（见下方「比心素材」）
  }
});
// ===== /BreakCard =====
```

> 💡 调试时可在 `maybeShowBreakCard` 第一行加 `console.log` 打印 `prevState -> nextState`，看真实状态序列，验证后删。
> 关键认知：忙碌态是 `thinking` + `working`（实测 Claude 不是单一 working）；完成路径是 `busy → attention → idle`，中间夹了庆祝态——所以用 `busyTimer` 跨过中间态，而不是死等 `working→idle`。

---

## 第 2 步：挂触发点（main.js + state.js）

clawd-on-desk 真实结构（已确认）：
- `src/main.js:1382` `const _stateCtx = {` … 到 `:1477` 的 `};` 结束
- `src/main.js:1478` `const _state = require("./state")(_stateCtx);`
- `src/state.js:44` `module.exports = function initState(ctx) {`，内部用 `ctx` 引用传进来的 `_stateCtx`
- `src/state.js:172` `let currentState = "idle";`
- `src/state.js:424` `function setState(newState, svgOverride, options = {})`，`:425` `if (shouldDropForDnd()) return;`

### 2a. main.js：在 `_stateCtx` 的 `};`（1477）前加一行（注意前面要有逗号）

```javascript
  onStateTransition: (prev, next) => maybeShowBreakCard(prev, next),
};
const _state = require("./state")(_stateCtx);
```

### 2b. state.js：在 setState 第一行报告跳变（`shouldDropForDnd` 之前插入）

```javascript
function setState(newState, svgOverride, options = {}) {
  // ===== BreakCard: 上报状态跳变（prev=currentState, next=newState）=====
  try {
    if (typeof ctx.onStateTransition === "function") {
      ctx.onStateTransition(currentState, newState);
    }
  } catch (e) {}
  // ===== /BreakCard =====
  if (shouldDropForDnd()) return;
```

> `currentState`=上一个状态，`newState`=将要变成的状态。

---

## 第 3 步：完成 → 螃蟹比心（几乎零工作）

浮窗的「✕ / 这次不练 / 做完」都用 `window.close()` **自己关窗**（不依赖 IPC，最可靠）。
完成时浮窗还会经 preload 发 `workout_done` 事件，main.js 的 `ipcMain.on("breakcard-event", ...)`（第 1 步末尾）收到后 `setState("attention")` 让螃蟹庆祝——`setState` 已在 1480 行从 `_state` 解构出来，直接可用。

---

## 弹卡时机：`design/triggers.json`（Claire 可改，引擎只读）

| 字段 | 含义 | 现值 |
|---|---|---|
| `minBusySec` | agent 连续忙满多少秒才算「真长任务」 | `75` |
| `idleSec` | 你输入静止多少秒才算「真在等」（不是盯着读） | `15` |
| `cooldownMin` | 两次弹出至少间隔分钟（无每日上限） | `40` |
| `activeHours` | 只在这个时段弹（24h 制，start>end 跨午夜） | `{start:8,end:22}` |
| `skipDuringStates` | 这些状态绝不弹 | `["notification","error","sleeping"]` |
| `enabled` | 总开关 | `true` |

⚠️ 改完需**重启 app** 才生效（引擎启动时读一次）。

---

## 比心素材：`clawd-love.svg` —— 完成时螃蟹专属比心

完成运动时引擎调 `setState("love")`，播放专属的「举爱心比心」动画（不是通用 happy）。两步，都在 clawd-on-desk 本地（属 AGPL 运行层，不入 aigym 仓库）：
1. 放素材：`clawd-on-desk/assets/svg/clawd-love.svg`（像素螃蟹举着心跳爱心 + 小爱心上飘，复用 clawd-happy 的弹跳/眨眼）
2. 注册状态：`themes/clawd/theme.json` 加
   - `states.love = ["clawd-love.svg"]`
   - `timings.minDisplay.love = 5000`、`timings.autoReturn.love = 5000`

> 想单独预览：浏览器直接打开 `clawd-love.svg` 就能看动画。

---

## 调试速查

- **想快点看到弹卡**：`design/triggers.json` 把 `minBusySec` 临时改 `8`，重启
- **倒计时太长**：`design/moves.json` 的 `config.durationSec` 改小（如 `10`）
- **浮窗不弹**：在 `maybeShowBreakCard` 加 console.log 看 `transition:` 序列，确认状态名对得上
- **完成不庆祝**：关窗靠 `window.close()` 不受影响；但 `setState("attention")` 靠 IPC，需确认 preload 加载成功
- **换小螃蟹素材**：替换 `themes/clawd/` 下动画，状态名对齐（idle/working/thinking/attention…，见 `themes/clawd/theme.json`）
