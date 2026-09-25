"use strict";

// 成長の可視化: リーダー記録1件がドル箱1箱。記録するほど、パチンコ店の島のように箱が積み上がる。
// 「全員」では3人の島を横に並べ、個人タブではその人の箱だけを大きく積む。
let growthSelectedId = null;
let growthListOpen = false;
let growthRecordSearch = "";

const DOLLBOX_FULL = 2000;

function growthData(){
  const all=allRecords();
  const graph=state.settings?.graph||{};
  const period=graph.period||"全期間";
  const cutoff=period==="今月"?`${today().slice(0,7)}-01`:period==="直近30日"?localKey(new Date(Date.now()-29*86400000)):period==="直近90日"?localKey(new Date(Date.now()-89*86400000)):"";
  const person=graph.author&&graph.author!=="全員"?graph.author:"全員";
  const inPeriod=all.filter(r=>!cutoff||dateKey(r.recordedAt)>=cutoff);
  const eligible=inPeriod.filter(r=>person==="全員"||r.author===person);
  const limit=[40,80,150].includes(Number(graph.limit))?Number(graph.limit):150;
  return {all,graph,period,person,inPeriod,eligible,shown:eligible.slice(0,limit).reverse(),limit};
}

function growthHash(value){
  let hash=2166136261;
  for(const char of String(value)){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}

// 1件の記録から出る玉の数。書いた量が多いほど箱が満ちる（最低250発、1箱2000発で満タン）。
function recordBalls(record){
  const length=String(record?.text||"").trim().length;
  return Math.min(DOLLBOX_FULL,250+Math.round(length*15/10)*10);
}
const ballsLabel = value => `${Number(value||0).toLocaleString("ja-JP")}`;

// 島に並べる人: 担当者の候補（岸・高野・髙岩）を先に、それ以外の記載者は後ろに。
function growthPeople(records){
  const owners=ownerChoices();
  const extra=[...new Set(records.map(r=>String(r.author||"").trim()).filter(name=>name&&!owners.includes(name)))].sort((a,b)=>a.localeCompare(b,"ja"));
  return [...owners,...extra];
}

// 積み方: 箱は下から上へ積み、高さがいっぱいになったら右の列へ。箱の大きさは画面に収まる最大に合わせる。
const DOLLBOX_ASPECT = 42/60, DOLLBOX_OVERLAP = .06;
function fitDollboxes(){
  document.querySelectorAll(".dollbox-stacks").forEach(stack=>{
    const count=Number(stack.dataset.count)||0,floor=stack.parentElement;
    if(!count||!floor)return;
    const width=floor.clientWidth-16,height=floor.clientHeight-16;
    const blocks=document.body.classList.contains("dz-on"),aspect=blocks?1:DOLLBOX_ASPECT,overlap=blocks?0:DOLLBOX_OVERLAP;
    if(width<=0||height<=0)return;
    let size=8;
    for(let s=Math.min(96,width);s>=8;s--){
      const step=s*(aspect-overlap);
      const rows=Math.max(1,Math.floor((height-s*overlap)/step));
      if(Math.ceil(count/rows)*s*1.04<=width){size=s;break;}
    }
    stack.style.setProperty("--boxpx",`${size}px`);
  });
}
window.addEventListener("resize",()=>{if(document.querySelector(".dollbox-stacks"))fitDollboxes();});

const DOLLBOX_SPRITE=`<svg class="dollbox-sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>
<linearGradient id="db-body-std" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a3c"/><stop offset=".55" stop-color="#d9261c"/><stop offset="1" stop-color="#8f130f"/></linearGradient>
<linearGradient id="db-body-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset=".28" stop-color="#e5b53d"/><stop offset=".55" stop-color="#a9741b"/><stop offset=".8" stop-color="#f3cf63"/><stop offset="1" stop-color="#7a4f10"/></linearGradient>
<linearGradient id="db-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/></linearGradient>
<radialGradient id="db-ball" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#d9dde3"/><stop offset=".8" stop-color="#7d838c"/><stop offset="1" stop-color="#4b5058"/></radialGradient>
<linearGradient id="db-heap" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f6f8"/><stop offset=".6" stop-color="#a9afb7"/><stop offset="1" stop-color="#6d737c"/></linearGradient>
</defs></svg>`;

function dollboxSvg(record){
  if(typeof dozleMode==="function"&&dozleMode())return dozleBlockSvg(record);
  const balls=recordBalls(record),peak=(3+13*balls/DOLLBOX_FULL).toFixed(1);
  const top=16-Number(peak);
  const dots=Array.from({length:7},(_,i)=>{const x=10+i*6.6,t=(x-30)/24,y=16-Number(peak)*(1-t*t)+1.6;return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.3" fill="url(#db-ball)"/>`;}).join("");
  return `<svg viewBox="0 0 60 42" aria-hidden="true"><path class="db-heap" d="M5 17 Q30 ${(top*2-16).toFixed(1)} 55 17 Z" fill="url(#db-heap)"/>${dots}<path class="db-body" d="M3 15 H57 L53 40 Q53 41 52 41 H8 Q7 41 7 40 Z"/><path class="db-shine" d="M8 18 H52 L51 23 H9 Z" fill="url(#db-rim)" opacity=".55"/><rect class="db-rim" x="1.5" y="13" width="57" height="4" rx="1.5"/><text class="db-count" x="30" y="34" text-anchor="middle">${esc(ballsLabel(balls))}</text></svg>`;
}

function dollboxStacks(records){
  if(!records.length)return `<div class="dollbox-empty">まだ箱はありません</div>`;
  const boxes=records.map((record,i)=>{
    const id=safeId(record.id);
    const label=`${formatDate(record.recordedAt,{year:"numeric",month:"long",day:"numeric"})}、${record.author||"記載者不明"}、出玉${ballsLabel(recordBalls(record))}発、${String(record.text||"").slice(0,80)}`;
    return `<button type="button" class="dollbox${id===growthSelectedId?" selected":""}${i===records.length-1?" latest":""}" style="--tilt:${(growthHash(id)%5-2)*.6}deg" data-action="select-growth-record" data-id="${esc(id)}" aria-label="${esc(label)}" aria-pressed="${id===growthSelectedId}" title="${esc(label)}">${dollboxSvg(record)}</button>`;
  });
  return `<div class="dollbox-stacks" data-count="${records.length}">${boxes.join("")}</div>`;
}

function personTotals(records){
  const balls=records.reduce((sum,r)=>sum+recordBalls(r),0);
  const days=new Set(records.map(r=>dateKey(r.recordedAt)).filter(Boolean)).size;
  return {boxes:records.length,balls,days};
}

// 連続して記録した日数（今日か昨日まで続いているもの）。パチンコの「連チャン」に見立てる。
function recordStreak(records){
  const days=new Set(records.map(r=>dateKey(r.recordedAt)).filter(Boolean));
  let cursor=new Date();
  if(!days.has(localKey(cursor)))cursor=new Date(cursor.getFullYear(),cursor.getMonth(),cursor.getDate()-1);
  let streak=0;
  while(days.has(localKey(cursor))){streak++;cursor=new Date(cursor.getFullYear(),cursor.getMonth(),cursor.getDate()-1);}
  return streak;
}

function growthPersonTabs(person,records){
  const people=growthPeople(records);
  const count=name=>records.filter(r=>name==="全員"||r.author===name).length;
  return `<div class="growth-person-tabs" role="group" aria-label="表示する人">${["全員",...people].map(name=>`<button type="button" class="growth-person-tab${person===name?" active":""}" data-action="growth-person" data-person="${esc(name)}" aria-pressed="${person===name}"><span>${name==="全員"?"全員":esc(name)}</span><small>${count(name)} 箱</small></button>`).join("")}</div>`;
}

function dollboxHall(person,shown){
  if(person!=="全員"){
    const totals=personTotals(shown);
    return `<div class="dollbox-hall single"><section class="dollbox-lane"><header class="dollbox-lane-head"><strong>${esc(person)}</strong><span>${totals.boxes} 箱 · ${ballsLabel(totals.balls)} 発</span></header><div class="dollbox-floor">${dollboxStacks(shown)}</div></section></div>`;
  }
  const people=growthPeople(shown).filter(name=>shown.some(r=>r.author===name)||ownerChoices().includes(name));
  const unknown=shown.filter(r=>!String(r.author||"").trim());
  const lanes=people.map(name=>[name,shown.filter(r=>r.author===name)]);
  if(unknown.length)lanes.push(["記載者不明",unknown]);
  if(!lanes.length)return `<div class="dollbox-hall"></div>`;
  const top=Math.max(...lanes.map(([,list])=>personTotals(list).balls));
  return `<div class="dollbox-hall" style="--lanes:${lanes.length}">${lanes.map(([name,list])=>{const totals=personTotals(list);const lead=totals.balls>0&&totals.balls===top;return `<section class="dollbox-lane${lead?" lead":""}"><header class="dollbox-lane-head"><strong>${lead?`<i class="dollbox-crown" aria-label="出玉トップ">♛</i>`:""}${esc(name)}</strong><span>${totals.boxes} 箱 · ${ballsLabel(totals.balls)} 発</span></header><div class="dollbox-floor">${dollboxStacks(list)}</div></section>`;}).join("")}</div>`;
}

function growthRanking(records){
  const people=growthPeople(records).map(name=>({name,...personTotals(records.filter(r=>r.author===name)),streak:recordStreak(records.filter(r=>r.author===name))})).sort((a,b)=>b.balls-a.balls||a.name.localeCompare(b.name,"ja"));
  const top=Math.max(1,...people.map(p=>p.balls));
  return `<div class="dollbox-ranking">${people.map((p,i)=>`<div class="dollbox-rank"><span class="dollbox-rank-no">${i+1}</span><span class="dollbox-rank-name">${esc(p.name)}</span><span class="dollbox-rank-track"><i style="width:${Math.round(p.balls/top*100)}%"></i></span><strong>${ballsLabel(p.balls)}</strong><small>${p.boxes}箱${p.streak>1?` · ${p.streak}連`:""}</small></div>`).join("")}</div>`;
}

function growthTrajectory(records){
  if(!records.length)return `<div class="growth-chart-empty">この条件に合う記録はまだありません。</div>`;
  const days=new Map();
  for(const record of records){const key=dateKey(record.recordedAt);if(key)days.set(key,(days.get(key)||0)+1);}
  const ordered=[...days].sort(([a],[b])=>a.localeCompare(b));
  if(!ordered.length)return `<div class="growth-chart-empty">日付のある記録がありません。</div>`;
  const start=new Date(`${ordered[0][0]}T00:00:00`).getTime();
  const end=new Date(`${ordered.at(-1)[0]}T00:00:00`).getTime();
  const span=Math.max(86400000,end-start);
  const total=ordered.reduce((sum,[,count])=>sum+count,0);
  const points=[];let cumulative=0;
  for(const [day,count] of ordered){
    cumulative+=count;
    const x=48+904*(new Date(`${day}T00:00:00`).getTime()-start)/span;
    const y=184-144*cumulative/total;
    points.push({x:Math.round(x),y:Math.round(y),day,count,cumulative});
  }
  let path="M 48 184";
  for(const point of points)path+=` H ${point.x} V ${point.y}`;
  path+=` H 952`;
  const last=points.at(-1);
  const area=`${path} V 184 H 48 Z`;
  return `<div class="growth-trajectory" role="img" aria-label="${esc(ordered[0][0])}から${esc(last.day)}までの累積記録。${total}件、記録した日は${ordered.length}日。">
    <svg viewBox="0 0 1000 220" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="growth-line" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#59dad7"/><stop offset="1" stop-color="#ff8cba"/></linearGradient><linearGradient id="growth-area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#9e8dff" stop-opacity=".28"/><stop offset="1" stop-color="#9e8dff" stop-opacity="0"/></linearGradient></defs>
      <path class="growth-gridline" d="M 48 184 H 952 M 48 112 H 952 M 48 40 H 952"/>
      <path d="${area}" fill="url(#growth-area)"/>
      <path class="growth-line" d="${path}"/>
      ${points.map((point,i)=>i===points.length-1||i===0||i%Math.max(1,Math.ceil(points.length/8))===0?`<circle class="growth-line-dot" cx="${point.x}" cy="${point.y}" r="4"/>`:"").join("")}
    </svg>
    <span class="growth-axis growth-axis-top">${total}件</span><span class="growth-axis growth-axis-bottom">0件</span>
    <div class="growth-trajectory-dates"><span>${esc(formatDate(ordered[0][0],{year:"numeric",month:"short",day:"numeric"}))}</span><span>${esc(formatDate(last.day,{year:"numeric",month:"short",day:"numeric"}))}</span></div>
  </div>`;
}

// Daily-update history as completion rates, so the checklist habit is visible next to the records.
function growthCheckRates(){
  const history=(state.checkHistory||[]).slice(-30);
  const rate=part=>part&&part.total?Math.round(part.done/part.total*100):null;
  const average=name=>{const values=history.map(entry=>rate(entry[name])).filter(value=>value!=null);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null;};
  const head=`<div class="growth-panel-head"><div><span class="growth-panel-kicker">DAILY CHECKS</span><h2>日次チェックの達成率</h2></div><span>${history.length?`直近 ${history.length} 回の日次更新`:""}</span></div>`;
  if(!history.length)return `<section class="growth-panel growth-check-rates">${head}<div class="growth-chart-empty">日次更新を実行すると、その日の早番・遅番の達成率がここに並びます。</div></section>`;
  const width=1000,height=180,slot=width/history.length,bar=Math.min(26,slot*.34);
  const bars=history.map((entry,i)=>{
    const x=i*slot+slot/2,parts=[["early",rate(entry.early),-1],["late",rate(entry.late),1]];
    return parts.map(([name,value,side])=>value==null?"":`<rect class="rate-${name}" x="${(x+side*bar*.55-bar/2).toFixed(1)}" y="${(height-value/100*(height-20)).toFixed(1)}" width="${bar.toFixed(1)}" height="${(value/100*(height-20)).toFixed(1)}" rx="3"><title>${esc(formatDate(entry.at,{month:"numeric",day:"numeric"}))} ${name==="early"?"早番":"遅番"} ${value}%</title></rect>`).join("");
  }).join("");
  const first=history[0],last=history.at(-1);
  return `<section class="growth-panel growth-check-rates">${head}
    <div class="growth-rate-summary"><span><i class="rate-early"></i>早番 平均 <strong>${average("early")??"–"}%</strong></span><span><i class="rate-late"></i>遅番 平均 <strong>${average("late")??"–"}%</strong></span></div>
    <div class="growth-rate-chart" role="img" aria-label="日次チェックの達成率。早番平均${average("early")??"不明"}%、遅番平均${average("late")??"不明"}%"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path class="growth-gridline" d="M0 ${height} H${width} M0 ${height/2+10} H${width} M0 20 H${width}"/>${bars}</svg></div>
    <div class="growth-trajectory-dates"><span>${esc(formatDate(first.at,{year:"numeric",month:"short",day:"numeric"}))}</span><span>${esc(formatDate(last.at,{year:"numeric",month:"short",day:"numeric"}))}</span></div>
    <p class="growth-panel-note">日次更新の時点での完了数 ÷ チェック項目数です。棒にカーソルを合わせると日付と数値を表示します。</p></section>`;
}
function growthView(){
  const {all,graph,period,person,inPeriod,eligible,shown,limit}=growthData();
  const days=new Set(shown.map(r=>dateKey(r.recordedAt)).filter(Boolean)).size;
  const selected=shown.find(r=>safeId(r.id)===growthSelectedId)||shown.at(-1)||null;
  if(selected)growthSelectedId=safeId(selected.id);
  const garo=typeof garoMode==="function"&&garoMode();
  const dozle=typeof dozleMode==="function"&&dozleMode();
  const totals=personTotals(shown);
  const streak=recordStreak(person==="全員"?all:all.filter(r=>r.author===person));
  const emptyMessage=all.length===0?"まだドル箱はありません。リーダー記録を追加すると、最初の1箱が積まれます。":eligible.length===0?"この条件に合う記録はありません。期間や人を変えてください。":"表示できる記録はありません。";
  const themeHits=(graph.themeKeywords||[]).map(theme=>({name:theme.theme,count:shown.filter(record=>(theme.keywords||[]).some(keyword=>String(record.text||"").toLocaleLowerCase().includes(String(keyword).toLocaleLowerCase()))).length})).filter(theme=>theme.count>0).sort((a,b)=>b.count-a.count).slice(0,6);
  const search=growthRecordSearch.trim().toLocaleLowerCase();
  const listed=[...shown].reverse().filter(record=>!search||`${record.recordedAt} ${record.author} ${record.text}`.toLocaleLowerCase().includes(search));
  const first=shown[0],last=shown.at(-1);
  const scope=person==="全員"?"全員":`${person} さん`;
  return title(garo?"GROWTH / GOLDEN DOLL BOX":dozle?"GROWTH / BLOCK TOWER":"GROWTH / DOLL BOX","成長の可視化",dozle?"記録1件がブロック1個。書いた量が多いほど、土→石→鉄→金→ダイヤと良いブロックになります。":garo?"記録1件が黄金のドル箱1箱。積み上げた出玉が、そのまま成長の証になります。":"記録1件がドル箱1箱。記録するほど、島にドル箱が積み上がっていきます。")+
    growthPersonTabs(person,inPeriod)+
    `<section class="growth-universe dollbox-universe${person==="全員"?" all":" personal"}" aria-label="${esc(scope)}のドル箱">
      <div class="growth-universe-head"><span class="growth-kicker"><i></i> ${dozle?(person==="全員"?"BLOCK TOWER · ALL LEADERS":`BLOCK TOWER · ${esc(person)}`):person==="全員"?"DOLL BOX ISLAND · ALL LEADERS":`DOLL BOX · ${esc(person)}`}</span><span class="growth-universe-count">全記録 ${all.length} 件</span></div>
      <div class="growth-universe-grid">
        <div class="growth-sky dollbox-sky">
          ${DOLLBOX_SPRITE}
          ${shown.length?dollboxHall(person,shown):`<div class="growth-sky-empty">${esc(emptyMessage)}</div>`}
          <div class="growth-sky-caption">${person==="全員"?"人ごとに、記録した順で下から積み上がります":"下から上へ、記録した順に積み上がります"}</div>
        </div>
        <aside class="growth-story">
          <span class="growth-story-label">${person==="全員"?"TEAM PAYOUT":"YOUR PAYOUT"}</span>
          <div class="growth-total dollbox-total"><strong>${ballsLabel(totals.balls)}</strong><span>${dozle?"XP":"発"}</span></div>
          <p class="growth-story-copy">${dozle?`${esc(scope)}の経験値。ブロック <b>${totals.boxes}</b> 個。書いた量が多い記録ほど、良いブロック（土→石→鉄→金→ダイヤ）になります。`:`${esc(scope)}の出玉。ドル箱 <b>${totals.boxes}</b> 箱。1箱は最大 ${ballsLabel(DOLLBOX_FULL)} 発で、書いた量が多い記録ほど玉が山盛りになります。`}</p>
          <div class="growth-story-facts"><div><strong>${days}</strong><span>記録した日</span></div><div><strong>${streak}</strong><span>連チャン（連続記録日）</span></div></div>
          ${person==="全員"?growthRanking(shown):""}
          <div class="growth-selected" aria-live="polite"><span>${dozle?"選んだブロック":"選んだドル箱"}</span>${selected?`<strong>${esc(formatDate(selected.recordedAt,{year:"numeric",month:"long",day:"numeric"}))}</strong><small>${esc(selected.author||"記載者不明")} · ${dozle?"XP":"出玉"} ${ballsLabel(recordBalls(selected))}${dozle?"":" 発"}</small><p>${esc(String(selected.text||"").slice(0,130))}${String(selected.text||"").length>130?"…":""}</p>`:`<p>ドル箱を選ぶと記録の内容を確認できます。</p>`}</div>
          ${person!=="全員"?`<button type="button" class="growth-show-all" data-action="show-all-growth">全員の島を見る →</button>`:""}
        </aside>
      </div>
      <div class="growth-universe-foot"><span>${dozle?"1個が表示中の記録1件　· 跳ねているのが最新の記録":"1箱が表示中の記録1件　· 箱の数字はその記録の出玉　· 光っているのが最新の記録"}</span><span>${first&&last?`${esc(formatDate(first.recordedAt,{month:"short",day:"numeric"}))} — ${esc(formatDate(last.recordedAt,{month:"short",day:"numeric"}))}`:"記録を待っています"}</span></div>
    </section>
    <section class="growth-controls" aria-label="成長画面の表示条件">
      <label>期間<select id="growth-period" class="search-input">${["全期間","今月","直近30日","直近90日"].map(value=>`<option value="${value}" ${period===value?"selected":""}>${value}</option>`).join("")}</select></label>
      <label>表示する人<select id="growth-author" class="search-input"><option value="全員" ${person==="全員"?"selected":""}>全員</option>${growthPeople(all).map(author=>`<option value="${esc(author)}" ${person===author?"selected":""}>${esc(author)}</option>`).join("")}</select></label>
      <label>表示件数<select id="growth-limit" class="search-input">${[40,80,150].map(value=>`<option value="${value}" ${limit===value?"selected":""}>${value}件</option>`).join("")}</select></label>
      <span class="growth-filter-count">表示 ${shown.length}箱 / 対象 ${eligible.length}件</span>
    </section>
    <div class="growth-lower">
      <section class="growth-panel"><div class="growth-panel-head"><div><span class="growth-panel-kicker">THE JOURNEY</span><h2>記録の軌跡</h2></div><span>${esc(scope)} · 表示中の ${shown.length} 件を累積</span></div>${growthTrajectory(shown)}<p class="growth-panel-note">記録のある日に段差が増えます。記録のない日は横線のまま表示します。</p></section>
      <section class="growth-panel"><div class="growth-panel-head"><div><span class="growth-panel-kicker">FOCUS AREAS</span><h2>見えてきた話題</h2></div></div>${themeHits.length?`<div class="growth-topics">${themeHits.map((theme,index)=>`<div class="growth-topic"><span class="growth-topic-rank">${String(index+1).padStart(2,"0")}</span><span class="growth-topic-name">${esc(theme.name)}</span><span class="growth-topic-track"><i style="width:${Math.round(theme.count/themeHits[0].count*100)}%"></i></span><strong>${theme.count}</strong></div>`).join("")}</div>`:`<div class="growth-chart-empty">表示中の記録に該当するキーワードはありません。</div>`}<p class="growth-panel-note">登録キーワードを含む記録の件数です。1件が複数の話題に該当することがあります。</p></section>
    </div>
    ${growthCheckRates()}
    <details class="growth-record-browser growth-panel" ${growthListOpen?"open":""}>
      <summary><span><small>RECORD INDEX</small><strong>${dozle?"ブロックを一覧から選ぶ":"ドル箱を一覧から選ぶ"}</strong></span><em>表示中 ${shown.length} 件　⌄</em></summary>
      <div class="growth-browser-content"><label for="growth-record-search">日付・記載者・内容で探す</label><input id="growth-record-search" class="search-input" value="${esc(growthRecordSearch)}" placeholder="記録を検索">
        <div class="growth-record-options">${listed.length?listed.map(record=>{const id=safeId(record.id);return `<button type="button" class="growth-record-option${id===growthSelectedId?" selected":""}" data-action="select-growth-record" data-id="${esc(id)}" aria-pressed="${id===growthSelectedId}"><strong>${esc(formatDate(record.recordedAt,{year:"numeric",month:"long",day:"numeric"}))}</strong><span>${esc(record.author||"記載者不明")}</span><small>${esc(String(record.text||"").slice(0,100))}</small></button>`;}).join(""):`<p class="growth-list-empty">一致する記録はありません。</p>`}</div>
      </div>
    </details>`;
}
