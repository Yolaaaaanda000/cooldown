/* =======================================================
   breakcard.js —— 场景盲盒抽卡逻辑（Yolanda / 后端）
   视图在 breakcard.html（Claire 的 neobrutalism 设计）。两人改不同文件，不冲突。

   ── 接口契约 ──
   - 读取：fetch("../design/moves.json")（contexts / moves[].tags / config / doneMessages / refuseReasons）
   - 抛事件：notifyHost("workout_done" | "workout_skipped" | "dismissed")
   - 宿主调用：window.breakcardSetGoal(goal)
   - 记录：localStorage（仅本地，不联网）
   ======================================================= */

let MOVES = [], GOALS = {}, CONTEXTS = {}, CTX_LIST = [], CONFIG = {}, DONE_MSGS = [], REASONS = [];
let CURRENT_GOAL = "strength", curCtx = "office", DURATION = 300;
let dealtMoves = [], chosen = null, chosenReason = null, ticking = null;
const $ = (id) => document.getElementById(id);
const DIMS = ["space", "noise", "social", "posture"];

const FALLBACK = {
  goals: { strength: "力量" },
  contexts: { office: { label: "🏢 办公室", max: { space: 1, noise: 0, social: 0, posture: 1 } } },
  config: { defaultContext: "office", drawCount: 6, durationSec: 300 },
  doneMessages: ["完成 ✓ 螃蟹给你比个心"],
  refuseReasons: ["待会儿再说"],
  moves: [{ zh: "站起来动一动", en: "Stand & Move", emoji: "🚶", goal: "strength", part: "全身", tags: { space: 0, noise: 0, social: 0, posture: 1 }, desc: "moves.json 未加载，这是占位动作。" }]
};

async function loadData() {
  let d;
  try {
    const r = await fetch("../design/moves.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    d = await r.json();
  } catch (e) {
    console.warn("[breakcard] moves.json 加载失败，用占位数据:", e);
    d = FALLBACK;
  }
  MOVES = d.moves || [];
  GOALS = d.goals || {};
  CONTEXTS = d.contexts || {};
  CONFIG = d.config || {};
  DONE_MSGS = (d.doneMessages && d.doneMessages.length) ? d.doneMessages : ["完成 ✓ 螃蟹给你比个心"];
  REASONS = d.refuseReasons || [];
  CTX_LIST = Object.keys(CONTEXTS).map(k => ({ key: k, label: CONTEXTS[k].label, max: CONTEXTS[k].max }));
  CURRENT_GOAL = CONFIG.defaultGoal || "strength";
  curCtx = CONFIG.defaultContext || (CTX_LIST[0] && CTX_LIST[0].key) || "office";
  DURATION = CONFIG.durationSec || 300;
}

/* ---- 场景过滤 + 加权抽样 ---- */
// 动作的每个 tag 都 ≤ 当前场景的 max，才进牌池
function eligible(ctxKey) {
  const max = (CONTEXTS[ctxKey] || {}).max || {};
  return MOVES.filter(m => DIMS.every(d => ((m.tags && m.tags[d]) || 0) <= (max[d] != null ? max[d] : 2)));
}
// 不放回加权抽样：命中当前目标的动作权重 ×3
function weightedSample(pool, n) {
  const ranked = pool.map(m => ({ m, k: Math.random() * ((CURRENT_GOAL && m.goal === CURRENT_GOAL) ? 3 : 1) }));
  ranked.sort((a, b) => b.k - a.k);
  return ranked.slice(0, Math.min(n, pool.length)).map(x => x.m);
}
function ctxLabelOf(key) {
  const c = CTX_LIST.find(x => x.key === key);
  return c ? c.label.replace(/^\S+\s*/, "") : key;
}

/* ---- 屏幕切换 ---- */
function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  if (id === "s-timer") startTimer();
  if (id === "s-done") celebrate();
}

/* ① 抽卡 */
function renderCtx() {
  const row = $("ctxRow"); row.innerHTML = "";
  CTX_LIST.forEach(c => {
    const el = document.createElement("div");
    el.className = "ctx" + (c.key === curCtx ? " active" : "");
    el.textContent = c.label;
    el.onclick = () => { curCtx = c.key; renderCtx(); deal(); };
    row.appendChild(el);
  });
  const cur = CTX_LIST.find(c => c.key === curCtx);
  if (cur) $("aiCtx").textContent = cur.label.replace(/^\S+\s*/, "");
}
function deal() {
  const pool = eligible(curCtx);
  dealtMoves = weightedSample(pool, CONFIG.drawCount || 6);
  $("poolInfo").textContent = `${dealtMoves.length} 张适合这里`;
  const grid = $("grid"); grid.innerHTML = "";
  dealtMoves.forEach((mv, i) => {
    const slot = document.createElement("div");
    slot.className = "slot dealing"; slot.style.animationDelay = (i * 55) + "ms";
    slot.innerHTML = `<div class="mini">
        <div class="mf mback"><div class="ring">🦀</div><div class="q">?</div></div>
        <div class="mf mfront"><div class="e">${mv.emoji}</div><div class="n">${mv.zh}</div></div>
      </div>`;
    slot.onclick = () => pick(slot, i);
    grid.appendChild(slot);
  });
}
function pick(slot, i) {
  if (slot.querySelector(".mini").classList.contains("flipped")) return;
  document.querySelectorAll("#grid .slot").forEach(s => { if (s !== slot) s.classList.add("dim"); });
  slot.querySelector(".mini").classList.add("flipped");
  chosen = dealtMoves[i];
  setTimeout(() => { fillReveal(chosen); show("s-reveal"); resetGridDim(); }, 700);
}
function resetGridDim() {
  document.querySelectorAll("#grid .slot").forEach(s => {
    s.classList.remove("dim");
    s.querySelector(".mini").classList.remove("flipped");
  });
}

/* ② 翻开详情 */
function fitLabels(tags) {
  const t = tags || {}, out = [];
  if ((t.posture || 0) === 0 && (t.space || 0) === 0) out.push("坐着也能做");
  if ((t.noise || 0) === 0) out.push("静音");
  if ((t.social || 0) === 0) out.push("不易察觉");
  if ((t.space || 0) <= 1) out.push("小范围");
  return out;
}
function fillReveal(m) {
  $("rGoal").textContent = GOALS[m.goal] || m.goal;
  $("rZh").textContent = m.zh; $("rEn").textContent = m.en;
  $("rEmoji").textContent = m.emoji; $("rDesc").textContent = m.desc;
  $("rTagGoal").textContent = GOALS[m.goal] || m.goal; $("rTagPart").textContent = m.part;
  const fit = $("rFit"); fit.innerHTML = "";
  fitLabels(m.tags).forEach(lbl => {
    const s = document.createElement("span"); s.className = "fit"; s.textContent = "✓ " + lbl; fit.appendChild(s);
  });
  const bc = $("bigCard"); bc.style.animation = "none"; void bc.offsetWidth; bc.style.animation = "";
}

/* ③ 倒计时 */
function startTimer() {
  if (!chosen) chosen = dealtMoves[0] || MOVES[0];
  $("tName").firstChild.textContent = chosen.zh; $("tEn").textContent = chosen.en;
  if (CONFIG.timerSub) $("tTip").textContent = CONFIG.timerSub;
  const C = 578; let left = DURATION;
  const render = () => {
    const mm = Math.floor(left / 60), ss = left % 60;
    $("tCount").textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    $("tProg").style.strokeDashoffset = C * (1 - left / DURATION);
  };
  render(); clearInterval(ticking);
  ticking = setInterval(() => { left--; if (left < 0) { clearInterval(ticking); onWorkoutDone(); return; } render(); }, 1000);
}

/* ④ 完成 */
function onWorkoutDone() {
  addRecord({ type: "done", zh: chosen.zh, emoji: chosen.emoji, ctxLabel: ctxLabelOf(curCtx), why: null, ts: Date.now() });
  notifyHost("workout_done");   // 让桌面螃蟹比心（主进程不关窗，庆祝屏停留）
  show("s-done");
}
function celebrate() {
  $("cheer").textContent = DONE_MSGS[Math.floor(Math.random() * DONE_MSGS.length)];
  const st = stats();
  $("streakN").textContent = st.streak; $("weekN").textContent = st.weekDone;
  const wrap = $("doneWrap");
  wrap.querySelectorAll(".confetti").forEach(c => c.remove());
  const colors = ["#ff5470", "#39c7ff", "#b6f23e", "#b18cff", "#ff8c3b"];
  for (let i = 0; i < 26; i++) {
    const c = document.createElement("div"); c.className = "confetti";
    c.style.left = (Math.random() * 100) + "%"; c.style.background = colors[i % colors.length];
    c.style.animationDuration = (1.1 + Math.random() * 1.1) + "s"; c.style.animationDelay = (Math.random() * .4) + "s";
    c.style.transform = `translateY(-20px) rotate(${Math.random() * 360}deg)`;
    wrap.appendChild(c);
  }
}

/* ⑤ 拒绝 */
function renderReasons() {
  const box = $("reasons"); box.innerHTML = ""; chosenReason = null;
  REASONS.forEach(r => {
    const el = document.createElement("div"); el.className = "reason"; el.textContent = r;
    el.onclick = () => {
      box.querySelectorAll(".reason").forEach(x => x.classList.remove("sel"));
      el.classList.add("sel"); chosenReason = r;
      $("refuseNote").textContent = "🦀 记下了，会照着调整下次的推荐";
    };
    box.appendChild(el);
  });
}
function onRefuse() {
  addRecord({ type: "skip", zh: (chosen || {}).zh || "—", emoji: (chosen || {}).emoji || "🦀", ctxLabel: ctxLabelOf(curCtx), why: chosenReason, ts: Date.now() });
  notifyHost("workout_skipped");
}

/* ⑥ 记录（localStorage，仅本地） */
const REC_KEY = "breakcard.records.v1";
function loadRecords() { try { return JSON.parse(localStorage.getItem(REC_KEY)) || []; } catch (e) { return []; } }
function saveRecords(a) { try { localStorage.setItem(REC_KEY, JSON.stringify(a.slice(0, 300))); } catch (e) {} }
function addRecord(rec) { const a = loadRecords(); a.unshift(rec); saveRecords(a); }
function stats() {
  const recs = loadRecords();
  const done = recs.filter(r => r.type === "done"), skip = recs.filter(r => r.type === "skip");
  const weekAgo = Date.now() - 7 * 864e5;
  const weekDone = done.filter(r => r.ts >= weekAgo).length;
  const daySet = new Set(done.map(r => new Date(r.ts).toDateString()));
  let streak = 0, d = new Date();
  while (daySet.has(d.toDateString())) { streak++; d = new Date(d.getTime() - 864e5); }
  const total = done.length + skip.length;
  return { weekDone, streak, rate: total ? Math.round(done.length / total * 100) : 0 };
}
function fmtWhen(ts) {
  const d = new Date(ts), now = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return "今天 " + hm;
  if (d.toDateString() === new Date(now.getTime() - 864e5).toDateString()) return "昨天 " + hm;
  return (d.getMonth() + 1) + "/" + d.getDate() + " " + hm;
}
let recFilter = "all";
function renderRecords() {
  const st = stats();
  const nums = document.querySelectorAll("#s-records .stats .num");
  if (nums[0]) nums[0].textContent = st.weekDone;
  if (nums[1]) nums[1].textContent = st.streak;
  if (nums[2]) nums[2].textContent = st.rate + "%";
  const list = $("recList"); list.innerHTML = "";
  const recs = loadRecords().filter(r => recFilter === "all" || r.type === recFilter);
  if (!recs.length) {
    list.innerHTML = `<div style="text-align:center;font-weight:700;opacity:.55;padding:26px 0">还没有记录，做完第一张就有了 🦀</div>`;
    return;
  }
  recs.forEach(r => {
    const el = document.createElement("div"); el.className = "rec";
    el.innerHTML = `<div class="ic">${r.emoji}</div>
      <div class="body">
        <div class="top"><span class="mv">${r.zh}</span>
          <span class="pill ${r.type}">${r.type === "done" ? "完成" : "拒绝"}</span>
          <span class="when">${fmtWhen(r.ts)}</span></div>
        <div class="meta">📍${r.ctxLabel}${r.why ? ` · <span class="why">原因：${r.why}</span>` : ""}</div>
      </div>`;
    list.appendChild(el);
  });
}
// 首次运行塞几条示例记录，让记录页 demo 时不空（清掉 localStorage 即重置）
function seedIfEmpty() {
  if (loadRecords().length) return;
  const t = Date.now();
  saveRecords([
    { type: "done", zh: "靠墙静蹲", emoji: "🧱", ctxLabel: "办公室", why: null, ts: t - 30 * 6e4 },
    { type: "done", zh: "颈部放松", emoji: "🧘", ctxLabel: "办公室", why: null, ts: t - 3 * 36e5 },
    { type: "skip", zh: "平板支撑", emoji: "💪", ctxLabel: "办公室", why: "环境不合适", ts: t - 26 * 36e5 },
    { type: "done", zh: "箱式呼吸", emoji: "🌬️", ctxLabel: "咖啡厅", why: null, ts: t - 27 * 36e5 },
    { type: "done", zh: "站姿提踵", emoji: "🦵", ctxLabel: "走廊", why: null, ts: t - 50 * 36e5 }
  ]);
}

/* ---- 与宿主通信 ---- */
function notifyHost(event) {
  if (window.breakcardAPI && window.breakcardAPI.notify) window.breakcardAPI.notify(event);
  else console.log("[breakcard] notifyHost:", event);
}
window.breakcardSetGoal = (g) => { CURRENT_GOAL = g; };

/* ---- 事件绑定 ---- */
$("reshuffle").onclick = deal;
$("rRedraw").onclick = () => { deal(); show("s-draw"); };
$("rStart").onclick = () => show("s-timer");
$("rSkip").onclick = () => { renderReasons(); show("s-refuse"); };
$("tGiveup").onclick = () => { clearInterval(ticking); renderReasons(); show("s-refuse"); };
$("tDone").onclick = () => { clearInterval(ticking); onWorkoutDone(); };
$("dClose").onclick = () => window.close();                 // 收下，关窗
$("dRecords").onclick = () => { renderRecords(); show("s-records"); };
$("fConfirm").onclick = () => { onRefuse(); renderRecords(); show("s-records"); };
$("fSkip").onclick = () => { onRefuse(); window.close(); };
$("recTabs").querySelectorAll(".tab").forEach(t => {
  t.onclick = () => {
    $("recTabs").querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active"); recFilter = t.dataset.f; renderRecords();
  };
});
document.querySelector(".titlebar .x").onclick = () => { notifyHost("dismissed"); window.close(); };

/* ---- 启动 ---- */
loadData().then(() => {
  seedIfEmpty();
  renderCtx();
  deal();
});
