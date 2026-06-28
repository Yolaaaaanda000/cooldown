#!/usr/bin/env node
/* BreakCard 注入器 —— 把 breakcard 接进一个 clawd-on-desk 检出。
   做四件事（全部幂等，已注入就跳过）：
     1) src/main.js   —— _stateCtx 加 onStateTransition + 注入 BreakCard 主块
     2) src/state.js  —— setState 第一行上报状态跳变
     3) themes/clawd/theme.json —— 注册 love 态（完成时比心）
     4) 放 clawd-love.svg + 软链 breakcard/ design/ 进 clawd-on-desk
   锚点找不到会报错退出（多半是 clawd-on-desk 版本与 install.sh 的 PIN 不符）。
   用法：node inject.cjs <clawd-on-desk 目录> [本仓库目录] */
const fs = require("fs");
const path = require("path");

const DEST = process.argv[2];
const AIGYM = process.argv[3] || path.resolve(__dirname, "..");
if (!DEST) { console.error("用法: node inject.cjs <clawd-on-desk-dir> [repo-dir]"); process.exit(1); }

const read = (p) => fs.readFileSync(p, "utf8");
const frag = (name) => read(path.join(__dirname, "fragments", name));

let changed = 0, skipped = 0;
function patchFile(rel, transform) {
  const file = path.join(DEST, rel);
  if (!fs.existsSync(file)) { console.error(`✗ 找不到 ${rel}（clawd-on-desk 目录对吗？）`); process.exit(1); }
  const before = read(file);
  const after = transform(before, rel);
  if (after === before) { console.log(`=  ${rel}：已注入，跳过`); skipped++; return; }
  fs.writeFileSync(file, after);
  console.log(`✓  ${rel}：已打补丁`);
  changed++;
}
function insertBefore(src, anchor, ins, rel) {
  const i = src.indexOf(anchor);
  if (i === -1) { console.error(`✗ ${rel}: 找不到锚点 \`${anchor.slice(0, 50)}…\` —— clawd-on-desk 版本可能与 PIN 不符`); process.exit(1); }
  return src.slice(0, i) + ins + src.slice(i);
}
function insertAfter(src, anchor, ins, rel) {
  const i = src.indexOf(anchor);
  if (i === -1) { console.error(`✗ ${rel}: 找不到锚点 \`${anchor.slice(0, 50)}…\` —— clawd-on-desk 版本可能与 PIN 不符`); process.exit(1); }
  const at = i + anchor.length;
  return src.slice(0, at) + ins + src.slice(at);
}

// 1) src/main.js
patchFile("src/main.js", (src, rel) => {
  if (src.includes("maybeShowBreakCard")) return src;                 // 已注入
  let out = insertBefore(src, '};\nconst _state = require("./state")(_stateCtx);', frag("main.statectx.js"), rel);
  out = insertAfter(out, "const sessions = _state.sessions;", "\n\n" + frag("main.block.js").replace(/\n+$/, ""), rel);
  return out;
});

// 2) src/state.js
patchFile("src/state.js", (src, rel) => {
  if (src.includes("ctx.onStateTransition")) return src;              // 已注入
  return insertAfter(src, "function setState(newState, svgOverride, options = {}) {\n", frag("state.sethook.js"), rel);
});

// 3) themes/clawd/theme.json
patchFile("themes/clawd/theme.json", (src) => {
  const t = JSON.parse(src);
  let dirty = false;
  t.states = t.states || {};
  if (!t.states.love) { t.states.love = ["clawd-love.svg"]; dirty = true; }
  t.timings = t.timings || {};
  t.timings.minDisplay = t.timings.minDisplay || {};
  t.timings.autoReturn = t.timings.autoReturn || {};
  if (t.timings.minDisplay.love == null) { t.timings.minDisplay.love = 5000; dirty = true; }
  if (t.timings.autoReturn.love == null) { t.timings.autoReturn.love = 5000; dirty = true; }
  return dirty ? JSON.stringify(t, null, 2) + "\n" : src;
});

// 4) 比心素材 + 软链
const svgDst = path.join(DEST, "assets", "svg", "clawd-love.svg");
fs.mkdirSync(path.dirname(svgDst), { recursive: true });
fs.copyFileSync(path.join(__dirname, "assets", "clawd-love.svg"), svgDst);
console.log("✓  assets/svg/clawd-love.svg：已放置");

for (const name of ["breakcard", "design"]) {
  const link = path.join(DEST, name);
  const target = path.join(AIGYM, name);
  let st = null; try { st = fs.lstatSync(link); } catch (e) {}
  if (st) { st.isSymbolicLink() ? fs.unlinkSync(link) : fs.rmSync(link, { recursive: true, force: true }); }
  fs.symlinkSync(target, link);
  console.log(`✓  软链 ${name} -> ${target}`);
}

console.log(`\n完成：${changed} 处打补丁，${skipped} 处已存在跳过。`);
