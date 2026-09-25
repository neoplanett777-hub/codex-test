"use strict";

// 黄金騎士モード: パチンコ演出（保留・予告カットイン・リーチ・大当り・RUSH・払い出し）を業務の進み具合に結びつける。
// 画像・音声ファイルは使わず、CSS・インラインSVG・Web Audio の合成音だけで描く。
// どの演出も業務データは変更しない。見た目と音だけ。

const GARO_LEVELS = {calm: "控えめ", normal: "標準", full: "全開"};
const garoLevel = () => GARO_LEVELS[state?.settings?.garoLevel] ? state.settings.garoLevel : "normal";
const garoSoundOn = () => state?.settings?.garoSound === true;
// 初期状態は「常に表示」。設定で「Windowsに合わせる」を選んだときだけ、Windowsのアニメーション設定で演出を控える。
const motionFollowsOs = () => state?.settings?.motionFollowOs === true;
const garoReducedMotion = () => motionFollowsOs() && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const motionButton = () => `<button type="button" class="secondary" data-action="toggle-motion-follow">${motionFollowsOs() ? "演出：Windowsの設定に合わせる" : "演出：常に表示"}</button>`;
const garoActive = () => typeof garoMode === "function" && garoMode();

// ---------- Sound: everything is synthesised on the fly ----------
let garoAudio = null;
function garoCtx(){
  if (!garoSoundOn()) return null;
  try {
    garoAudio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (garoAudio.state === "suspended") garoAudio.resume();
    return garoAudio;
  } catch { return null; }
}
function garoTone(freq, duration, {type = "sine", gain = .18, when = 0, slideTo = null, attack = .005} = {}){
  const ctx = garoCtx(); if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t); osc.stop(t + duration + .02);
}
function garoNoise(duration, {when = 0, gain = .12, freq = 4200, q = 1.2} = {}){
  const ctx = garoCtx(); if (!ctx) return;
  const t = ctx.currentTime + when, length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = ctx.createBufferSource(), band = ctx.createBiquadFilter(), amp = ctx.createGain();
  src.buffer = buffer; band.type = "bandpass"; band.frequency.value = freq; band.Q.value = q; amp.gain.value = gain;
  src.connect(band).connect(amp).connect(ctx.destination); src.start(t);
}
const garoSfx = {
  hold(){ garoTone(880, .12, {type: "triangle", slideTo: 1480, gain: .16}); },
  check(){ garoTone(1320, .08, {type: "square", gain: .06}); garoTone(1760, .1, {type: "sine", gain: .1, when: .05}); },
  cutin(){ garoTone(2600, .5, {slideTo: 900, gain: .12}); garoTone(3900, .35, {type: "triangle", slideTo: 1600, gain: .06}); garoNoise(.25, {gain: .08, freq: 7000}); },
  reach(){ for (let i = 0; i < 4; i++) { garoTone(i % 2 ? 622 : 523, .18, {type: "sawtooth", gain: .07, when: i * .2}); } },
  payout(count = 24){ for (let i = 0; i < count; i++) garoNoise(.03, {when: i * .045 + Math.random() * .02, gain: .09, freq: 3500 + Math.random() * 2500, q: 6}); },
  fanfare(){
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => garoTone(f, .22, {type: "sawtooth", gain: .08, when: i * .11}));
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(f => garoTone(f, 1.1, {type: "square", gain: .035, when: .5}));
    garoTone(2093, 1.2, {gain: .05, when: .5});
  }
};

// ---------- Stage helpers ----------
function garoAnnounce(text){ const el = $("#garo-announce"); if (el) { el.textContent = ""; setTimeout(() => { el.textContent = text; }, 30); } }
function garoMount(html, ms){
  const stage = $("#garo-stage"); if (!stage) return null;
  const wrap = document.createElement("div");
  wrap.className = "garo-layer";
  wrap.innerHTML = html;
  stage.append(wrap);
  setTimeout(() => wrap.remove(), ms);
  return wrap;
}
const GARO_TIERS = {blue: "青", green: "緑", red: "赤", gold: "金", rainbow: "虹"};

function garoCutin(kicker, headline, sub = "", tier = "blue"){
  garoAnnounce(`${kicker} ${headline} ${sub}`);
  if (garoLevel() === "calm" || garoReducedMotion()) { flash(`${kicker}：${headline}`); return; }
  garoSfx.cutin();
  garoMount(`<div class="garo-cutin tier-${tier}"><div class="garo-cutin-band"></div><div class="garo-cutin-frame"><span class="garo-cutin-kicker">${esc(kicker)}</span><strong class="garo-cutin-title">${esc(headline)}</strong>${sub ? `<small class="garo-cutin-sub">${esc(sub)}</small>` : ""}</div><div class="garo-cutin-slash"></div></div>`, 2600);
}

// An original emblem: a golden ring with a stylised wolf-helm and a sword. Not taken from any machine artwork.
const GARO_EMBLEM = `<svg class="garo-emblem-svg" viewBox="0 0 200 200" aria-hidden="true"><defs>
<radialGradient id="ge-core" cx=".5" cy=".42" r=".6"><stop offset="0" stop-color="#fff7d0"/><stop offset=".35" stop-color="#f3c955"/><stop offset=".75" stop-color="#a86d12"/><stop offset="1" stop-color="#4a2c05"/></radialGradient>
<linearGradient id="ge-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffbe6"/><stop offset=".3" stop-color="#e8b43a"/><stop offset=".6" stop-color="#8f5a0e"/><stop offset="1" stop-color="#f7d774"/></linearGradient></defs>
<circle cx="100" cy="100" r="94" fill="none" stroke="url(#ge-metal)" stroke-width="8"/>
<circle cx="100" cy="100" r="82" fill="#120a02" stroke="#f3c955" stroke-width="2"/>
${Array.from({length: 24}, (_, i) => `<rect x="98" y="8" width="4" height="10" fill="#f3c955" transform="rotate(${i * 15} 100 100)"/>`).join("")}
<path d="M100 26 L106 40 V150 L100 170 L94 150 V40 Z" fill="url(#ge-metal)"/>
<rect x="76" y="138" width="48" height="7" rx="2" fill="url(#ge-metal)"/>
<path d="M58 60 L78 82 L100 74 L122 82 L142 60 L138 100 L126 118 L112 126 L100 142 L88 126 L74 118 L62 100 Z" fill="url(#ge-core)" stroke="#fff1b8" stroke-width="1.5"/>
<path d="M76 98 L92 104 L84 110 Z M124 98 L108 104 L116 110 Z" fill="#0c7a3e"/>
<path d="M90 120 L100 128 L110 120" fill="none" stroke="#3a2202" stroke-width="3" stroke-linecap="round"/>
</svg>`;

function garoBigHit(title, sub, detail = ""){
  garoAnnounce(`${title} ${sub} ${detail}`);
  if (garoReducedMotion()) { flash(`${title} ${sub}`); return; }
  garoSfx.fanfare();
  if (garoLevel() === "calm") { garoMount(`<div class="garo-bighit calm"><div class="garo-bighit-title">${esc(title)}</div><div class="garo-bighit-sub">${esc(sub)}</div></div>`, 2600); return; }
  const sparks = Array.from({length: garoLevel() === "full" ? 70 : 40}, (_, i) => `<i style="left:${(i * 37) % 100}%;--d:${(i % 9) * .12}s;--x:${((i * 53) % 120) - 60}px;--s:${4 + (i % 5) * 2}px"></i>`).join("");
  garoMount(`<div class="garo-bighit"><div class="garo-flash"></div><div class="garo-rays"></div><div class="garo-sparks">${sparks}</div><div class="garo-emblem">${GARO_EMBLEM}</div><div class="garo-bighit-title">${esc(title)}</div><div class="garo-bighit-sub">${esc(sub)}</div>${detail ? `<div class="garo-bighit-detail">${esc(detail)}</div>` : ""}</div>`, 4200);
}

function garoPayout(balls, label = ""){
  garoAnnounce(`出玉 ${balls} 発`);
  if (garoReducedMotion()) return;
  garoSfx.payout(Math.min(40, 10 + Math.round(balls / 80)));
  const count = garoLevel() === "calm" ? 12 : garoLevel() === "full" ? 48 : 30;
  const rain = Array.from({length: count}, (_, i) => `<i style="--x:${(i * 29) % 100}%;--d:${(i % 12) * .06}s;--r:${(i % 7) * 12 - 36}px"></i>`).join("");
  garoMount(`<div class="garo-payout"><div class="garo-balls">${rain}</div><div class="garo-payout-box"><span>${esc(label || "ドル箱 +1")}</span><strong>+${ballsLabel(balls)}<small>発</small></strong></div></div>`, 2400);
}

// ---------- 保留 (hold) icons: the next four open TODOs, coloured by how hot they are ----------
function garoHoldTier(todo){
  const due = dateKey(todo.dueDate);
  if (due && due < today()) return "gold";
  if (due && due === today()) return "red";
  if (todo.priority === "high") return "green";
  if (due && due <= localKey(new Date(Date.now() + 3 * 86400000))) return "blue";
  return "white";
}
function renderGaroHolds(){
  const box = $("#garo-holds"); if (!box) return;
  if (!garoActive() || !state) { box.innerHTML = ""; return; }
  const open = pendingTodos().slice(0, 4);
  const labels = {gold: "金保留・期限切れ", red: "赤保留・今日まで", green: "緑保留・優先度高", blue: "青保留・3日以内", white: "通常保留"};
  box.innerHTML = `<span class="garo-holds-label">保留</span>${Array.from({length: 4}, (_, i) => {
    const todo = open[i];
    if (!todo) return `<i class="garo-hold empty" aria-hidden="true"></i>`;
    const tier = garoHoldTier(todo);
    return `<button type="button" class="garo-hold tier-${tier}" data-view="todos" title="${esc(`${labels[tier]}：${todo.text}`)}" aria-label="${esc(`${labels[tier]}：${todo.text}`)}"></button>`;
  }).join("")}${pendingTodos().length > 4 ? `<span class="garo-holds-more">+${pendingTodos().length - 4}</span>` : ""}`;
}

// ---------- Sidebar counters ----------
function garoTeamStreak(){ return typeof recordStreak === "function" ? recordStreak(state.records || []) : 0; }
function renderGaroVitals(){
  renderGaroHolds();
  const sound = $("#garo-sound");
  if (sound) { sound.textContent = garoSoundOn() ? "♪ ON" : "♪ OFF"; sound.setAttribute("aria-pressed", String(garoSoundOn())); }
  const box = $("#garo-vitals"); if (!box) return;
  if (!garoActive()) { box.innerHTML = ""; if (typeof renderDozleVitals === "function") renderDozleVitals(); return; }
  const records = state.records || [];
  const balls = records.reduce((sum, r) => sum + recordBalls(r), 0);
  const early = countShift("early"), late = countShift("late"), total = early.total + late.total, done = early.done + late.done;
  const rush = total ? Math.round(done / total * 100) : 0;
  const me = typeof currentUser === "function" ? currentUser() : "";
  const mine = me ? records.filter(r => r.author === me).reduce((sum, r) => sum + recordBalls(r), 0) : null;
  box.innerHTML = `<div class="garo-counter"><span>総出玉</span><strong>${String(balls).padStart(6, "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}</strong></div>${mine != null ? `<div class="garo-counter small"><span>${esc(me)}</span><strong>${ballsLabel(mine)}</strong></div>` : ""}<div class="garo-counter small"><span>連チャン</span><strong>${garoTeamStreak()}</strong></div><div class="garo-meter ${rush >= 100 ? "full" : ""}"><span>RUSH ゲージ</span><b>${rush}%</b><i style="width:${rush}%"></i></div>`;
}

// ---------- Banner on home / checklist ----------
function garoBanner(sections){
  if (!garoActive()) return "";
  const counts = sections.map(countShift), done = counts.reduce((n, c) => n + c.done, 0), total = counts.reduce((n, c) => n + c.total, 0);
  if (!total) return "";
  const scope = sections.length > 1 ? "早番・遅番" : sections[0] === "early" ? "早番" : "遅番";
  const left = total - done, percent = Math.round(done / total * 100);
  if (!left) return `<div class="garo-banner rush" role="status"><span class="garo-banner-mark" aria-hidden="true">${GARO_EMBLEM}</span><div><strong>GOLD RUSH 継続中</strong><span>${scope}のチェックを完全制覇。黄金の輝きで、今日の業務を締めくくろう。</span></div></div>`;
  if (left === 1) return `<div class="garo-banner reach" role="status"><div><strong>リーチ！</strong><span>${scope}のチェック、あと 1 件で GOLD RUSH 突入。</span></div><em class="garo-banner-hot">激アツ</em></div>`;
  const heat = percent >= 70 ? "red" : percent >= 40 ? "green" : "blue";
  return `<div class="garo-banner pending heat-${heat}" role="status"><div><strong>GOLD RUSH まで あと ${left} 件</strong><span>${scope}のチェック ${done}/${total}。期待度が上がるほど保留の色が変わります。</span></div><div class="garo-expect" aria-label="期待度 ${percent}%"><i style="width:${percent}%"></i><b>期待度</b></div></div>`;
}

// ---------- Business events → performance ----------
const garoRoll = () => Math.random();
function garoHandleEvent(type, detail = {}){
  if (!garoActive()) return;
  if (type === "check") {
    const shiftName = detail.shift, c = countShift(shiftName), label = shiftName === "early" ? "早番" : "遅番";
    const left = c.total - c.done;
    if (left === 0) { garoBigHit("GOLD RUSH", "突入!!", `${label}のチェックを完全制覇`); return; }
    if (left === 1) { garoSfx.reach(); garoCutin("リーチ", `${label} あと1件`, "次のチェックで GOLD RUSH", "red"); return; }
    garoSfx.check();
    const roll = garoRoll();
    if (garoLevel() !== "calm" && roll < .12) garoCutin("チャンス", `${label} 残り ${left} 件`, "", roll < .03 ? "green" : "blue");
    return;
  }
  if (type === "todo") {
    const todo = detail.todo || {}, tier = garoHoldTier(todo);
    if (!pendingTodos().length) { garoBigHit("全TODO撃破", "BONUS", "未完了のTODOがゼロになりました"); return; }
    const pick = tier === "gold" ? "gold" : tier === "red" ? "red" : tier === "green" ? "green" : (() => { const r = garoRoll(); return r < .04 ? "rainbow" : r < .14 ? "red" : r < .4 ? "green" : "blue"; })();
    const kicker = {gold: "激アツ", red: "熱い", green: "チャンス", blue: "撃破", rainbow: "確定"}[pick];
    garoCutin(kicker, "TODO 撃破", String(todo.text || "").slice(0, 40), pick);
    return;
  }
  if (type === "todo-add") { garoSfx.hold(); document.querySelectorAll(".garo-hold:not(.empty)").forEach(el => { el.classList.remove("changed"); void el.offsetWidth; el.classList.add("changed"); }); return; }
  if (type === "record") {
    const record = detail.record, balls = recordBalls(record), mine = (state.records || []).filter(r => r.author === record.author).length;
    garoPayout(balls, `${record.author || "記録"} · ドル箱 +1`);
    if (mine > 0 && mine % 10 === 0) setTimeout(() => garoBigHit("大当り", `${mine} 箱達成`, `${record.author || ""} の積み上げが ${mine} 箱に到達`), 1500);
    else { const streak = recordStreak((state.records || []).filter(r => r.author === record.author)); if (streak >= 3) setTimeout(() => garoCutin("連チャン", `${streak} 連チャン中`, `${record.author || ""}：${streak} 日連続で記録`, streak >= 7 ? "gold" : "red"), 1300); }
    return;
  }
  if (type === "daily") { garoCutin("精算", "本日の業務 お疲れさまでした", detail.drafts ? `記録 ${detail.drafts} 件をドル箱へ` : "チェックは実施記録に残しました", "gold"); if (detail.drafts) setTimeout(() => garoPayout(detail.drafts * 500, "日次更新"), 900); return; }
  if (type === "merge") {
    const s = detail.summary || {};
    if (s.recordsAdded) { garoCutin("合流", `${s.from || "仲間"} の出玉が合流`, `ドル箱 +${s.recordsAdded} 箱`, s.recordsAdded >= 5 ? "gold" : "red"); setTimeout(() => garoPayout(s.recordsAdded * 600, "共有データ"), 1100); }
  }
}

// ---------- Theme hooks and settings ----------
function garoApplyTheme(theme){
  document.body.classList.toggle("garo-on", theme === "garo");
  if (theme !== "garo") { const stage = $("#garo-stage"); if (stage) stage.innerHTML = ""; }
  renderGaroVitals();
}
async function garoToggleSound(){
  if (!state) return;
  const next = !garoSoundOn();
  await saveSettingsChange(() => { state.settings.garoSound = next; }, next ? "演出音をオンにしました" : "演出音をオフにしました");
  if (next) garoSfx.hold();
}
function garoSettingsView(){
  const level = garoLevel();
  return `<div class="garo-settings"><strong>黄金騎士モードの演出</strong><div class="settings-drink-options" role="group" aria-label="演出の強さ">${Object.entries(GARO_LEVELS).map(([value, name]) => `<button type="button" class="garo-level ${level === value ? "active" : ""}" data-action="set-garo-level" data-level="${value}" aria-pressed="${level === value}">${name}</button>`).join("")}</div><div class="settings-data-actions"><button type="button" class="secondary" data-action="toggle-garo-sound">${garoSoundOn() ? "演出音：オン" : "演出音：オフ"}</button><button type="button" class="secondary" data-action="garo-demo">演出を試す</button>${motionButton()}</div><small class="note">保留＝未完了TODO（金＝期限切れ・赤＝今日まで・緑＝優先度高・青＝3日以内）。チェック完了でリーチ→GOLD RUSH、TODO完了でカットイン、記録追加で出玉とドル箱が増えます。控えめでは画面全体の演出を抑えます。</small></div>`;
}
document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]"); if (!button || !state) return;
  if (button.dataset.action === "set-garo-level") {
    const level = button.dataset.level;
    if (!GARO_LEVELS[level] || level === garoLevel()) return;
    await saveSettingsChange(() => { state.settings.garoLevel = level; }, `演出の強さを「${GARO_LEVELS[level]}」にしました`);
  }
  if (button.dataset.action === "garo-demo" && garoActive()) {
    garoCutin("激アツ", "予告演出テスト", "金カットイン", "gold");
    setTimeout(() => garoPayout(1250, "ドル箱 +1"), 1500);
    setTimeout(() => garoBigHit("GOLD RUSH", "突入!!", "演出テスト"), 3300);
  }
});
