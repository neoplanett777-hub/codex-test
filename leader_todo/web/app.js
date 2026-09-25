"use strict";

const $ = (selector) => document.querySelector(selector);
const main = $("#main");
const dialog = $("#edit-dialog");
let state = null;
let currentView = "home";
let shift = "early";
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarSelectedDate = null;
let calendarSideTimer = null;
let todoFilter = "open";
let todoSearch = "";
let todoCategory = "";
let undoSnapshot = null;
let recordSearch = "";
let recordShowTrash = false;
let referenceDepartment = "";
let referenceSearch = "";
let saveChain = Promise.resolve();
let browserLastSaveError = null;
let settingsBusy = false;
let toastTimer;

const labels = {home:"ホーム",checklist:"日次チェック",todos:"自由 TODO",calendar:"カレンダー",records:"リーダー記録",growth:"成長の可視化",hp:"HP 画像チェック",references:"関連リンク",settings:"設定"};
const startViewChoices = ["home","checklist","todos","calendar","records","growth","hp","references"];
currentView = labels[location.hash.slice(1)] ? location.hash.slice(1) : "home";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const dateKey = (value) => value ? String(value).slice(0,10) : "";
const localKey = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const localTimestamp = () => {const d=new Date();return `${localKey(d)}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;};
const today = () => localKey(new Date());
const formatDate = (value, options={month:"numeric",day:"numeric"}) => {const raw=String(value||"");const match=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);if(!match)return "期日なし";const [,y,m,d,h="0",minute="0",second="0"]=match;return new Intl.DateTimeFormat("ja-JP",options).format(new Date(Number(y),Number(m)-1,Number(d),Number(h),Number(minute),Number(second)));};
const safeId = (value) => String(value ?? "");
const byId = (list,id) => list.find(item => safeId(item.id)===safeId(id));
const ownerChoices = () => [...new Set((Array.isArray(state?.owners)?state.owners:[]).filter(name=>typeof name==="string"&&name.trim()).map(name=>name.trim()))];
const ownerOptions = selected => {const candidates=ownerChoices(),names=[...candidates];if(selected&&!names.includes(selected))names.push(selected);return `<option value="" ${selected?"":"selected"}>担当未設定</option>${names.map(name=>`<option value="${esc(name)}" ${name===selected?"selected":""}>${esc(name)}${!candidates.includes(name)?"（過去の担当）":""}</option>`).join("")}`;};
const defaultTodoOwner = () => ownerChoices().includes(state?.settings?.defaultTodoOwner) ? state.settings.defaultTodoOwner : "";
const startView = () => startViewChoices.includes(state?.settings?.startView) ? state.settings.startView : "home";
// リーダーTODOの対象者。初回起動時だけ候補に入れ、あとは設定画面で自由に変更できる。
const DEFAULT_LEADERS=["岸","高野","髙岩"];
const currentUser = () => ownerChoices().includes(state?.settings?.me) ? state.settings.me : "";
function ensureSettingsState(){
  state.settings??={};
  if(!Array.isArray(state.owners))state.owners=[];
  if(state.settings.ownerCandidatesInitialized===true)return false;
  for(const name of DEFAULT_LEADERS)if(!state.owners.includes(name))state.owners.push(name);
  state.settings.ownerCandidatesInitialized=true;
  return true;
}
// Calendar entries migrated from Excel had no id; edits must never target an entry by position.
function ensureCalendarIds(){let changed=false;for(const entry of state.settings?.calendarEntries||[])if(!entry.id){entry.id=uid();changed=true;}return changed;}
const actionable = (item) => ["T","S"].includes(item.kind);
const countShift = (name) => {const list=(state.shiftSections?.[name]||[]).filter(actionable);return {done:list.filter(x=>x.completed).length,total:list.length};};
// A timed check counts as late once the clock passes its time and it is still unchecked.
const nowHm = () => {const d=new Date();return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;};
const isLateCheck = (item) => actionable(item) && !item.completed && !!item.time && String(item.time).slice(0,5) <= nowHm();
const lateChecks = (name) => (state.shiftSections?.[name]||[]).filter(isLateCheck);
const repeatLabels = {daily:"毎日",weekly:"毎週",monthly:"毎月"};
const repeatOptions = selected => `<option value="" ${selected?"":"selected"}>繰り返さない</option>${Object.entries(repeatLabels).map(([value,label])=>`<option value="${value}" ${value===selected?"selected":""}>${label}</option>`).join("")}`;
// The next due date keeps the original day of month, so 1/31 → 2/28 → 3/31 does not drift.
function nextRepeatDue(due,unit,day){
  const [y,m,d]=due.split("-").map(Number);
  if(unit==="daily"||unit==="weekly")return localKey(new Date(y,m-1,d+(unit==="daily"?1:7)));
  const last=new Date(y,m+1,0).getDate();
  return localKey(new Date(y,m,Math.min(day||d,last)));
}
// "10月両替金リスト" becomes "11月両替金リスト" when a monthly TODO repeats.
function nextRepeatText(text,unit){
  if(unit!=="monthly")return text;
  const months=[...String(text).matchAll(/(\d{1,2})月/g)].filter(match=>Number(match[1])>=1&&Number(match[1])<=12);
  if(months.length!==1)return text;
  return String(text).replace(/(\d{1,2})月/,`${Number(months[0][1])%12+1}月`);
}
function createNextRepeat(todo){
  if(!todo.repeat||!repeatLabels[todo.repeat]||!todo.dueDate||todo.repeatNextId)return null;
  const due=dateKey(todo.dueDate),day=todo.repeatDay||Number(due.slice(8,10));
  const next={id:uid(),updatedAt:localTimestamp(),text:nextRepeatText(todo.text,todo.repeat),dueDate:nextRepeatDue(due,todo.repeat,day),owner:todo.owner||null,completed:false,repeat:todo.repeat,repeatDay:todo.repeat==="monthly"?day:undefined,priority:todo.priority,category:todo.category};
  todo.repeatNextId=next.id;
  state.todos.push(next);
  return next;
}
const priorityLabels = {high:"高",low:"低"};
const priorityRank = todo => todo.priority==="high"?0:todo.priority==="low"?2:1;
const priorityOptions = selected => `<option value="high" ${selected==="high"?"selected":""}>高</option><option value="" ${!priorityLabels[selected]?"selected":""}>普通</option><option value="low" ${selected==="low"?"selected":""}>低</option>`;
const todoCategories = () => [...new Set([...(state.todos||[]),...(state.todoArchive||[])].map(t=>String(t.category||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"ja"));
// Priority first, then the nearest due date: "high" work surfaces even without a date.
const byPriorityAndDue = (a,b) => priorityRank(a)-priorityRank(b) || (dateKey(a.dueDate)||"9999").localeCompare(dateKey(b.dueDate)||"9999") || String(a.text).localeCompare(String(b.text),"ja");
const pendingTodos = () => (state.todos||[]).filter(t=>!t.completed).sort(byPriorityAndDue);
const allRecords = () => [...(state.records||[])].sort((a,b)=>String(b.recordedAt||"").localeCompare(String(a.recordedAt||"")));
const cssBadge = (due,done=false) => {if(done)return "done"; if(!due)return ""; return due<today()?"overdue":due===today()?"today":"";};
const dueLabel = (due,done=false) => {if(done)return "完了"; if(!due)return "期日なし"; if(due<today())return "期限切れ";if(due===today())return "今日";return formatDate(due);};
// 共有取り込みで「どちらが新しいか」を決めるため、変更した項目に更新時刻を残す。
const touch = item => {if(item)item.updatedAt=localTimestamp();return item;};
// 削除した項目のIDを残し、共有取り込みで他の人のデータから復活しないようにする。
function tombstone(kind,id){if(!id)return;state.tombstones=[...(state.tombstones||[]),{kind,id:safeId(id),at:localTimestamp()}].slice(-2000);}
const garoEvent = (type,detail={}) => {for(const handler of [globalThis.garoHandleEvent,globalThis.dozleHandleEvent])if(typeof handler==="function")try{handler(type,detail);}catch(error){console.error(error);}};
const garoChampion = sections => (typeof garoBanner==="function"?garoBanner(sections):"")+(typeof dozleBanner==="function"?dozleBanner(sections):"");
const uid = () => globalThis.crypto?.randomUUID?.() || `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const themeNames = {standard:"標準",garo:"黄金騎士",dozle:"ドズル社風"};
const uiTheme = () => themeNames[state?.settings?.uiTheme] && state.settings.uiTheme !== "standard" ? state.settings.uiTheme : "standard";
const garoMode = () => uiTheme() === "garo";
function applyTheme(){
  const theme=uiTheme();
  document.documentElement.dataset.theme=theme;
  document.documentElement.style.colorScheme=theme==="standard"?"light":"dark";
  document.documentElement.dataset.motion=state?.settings?.motionFollowOs===true?"os":"always";
  $("#brand-mark").textContent=theme==="garo"?"騎":theme==="dozle"?"ド":"L";
  $("#brand-caption").textContent=theme==="garo"?"GOLDEN KNIGHT MODE":theme==="dozle"?"DOZLE FAN STYLE":"Leader workspace";
  document.querySelectorAll(".theme-switch [data-theme]").forEach(button=>{
    const active=button.dataset.theme===theme;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
  if(typeof garoApplyTheme==="function")garoApplyTheme(theme);
  if(typeof dozleApplyTheme==="function")dozleApplyTheme(theme);
}

async function api(path,method="GET",body) {
  const bridge=window.pywebview?.api;
  if(!bridge)throw new Error("アプリの保存機能を起動できませんでした");
  if(path==="/api/state"&&method==="GET")return bridge.get_state();
  if(path==="/api/state"&&method==="PUT")return bridge.save_state(body);
  if(path==="/api/hp-check")return bridge.check_hp(body.storeId);
  if(path==="/api/open-link")return bridge.open_link(body.url);
  if(path==="/api/validate-reference-target")return bridge.validate_reference_target(body.url);
  if(path==="/api/choose-link-file")return bridge.choose_link_file();
  if(path==="/api/choose-link-base-dir")return bridge.choose_link_base_dir();
  if(path==="/api/link-status")return bridge.get_link_status(body);
  if(path==="/api/open-data-folder")return bridge.open_data_folder();
  if(path==="/api/report-pdf")return bridge.save_report_pdf(body);
  if(path==="/api/backup")return bridge.backup_now(body.reason);
  if(path==="/api/choose-excel-file")return bridge.choose_excel_file();
  throw new Error("対応していない操作です");
}
function flash(message,undo=false){const el=$("#toast");el.innerHTML=`<span>${esc(message)}</span>${undo?`<button type="button" class="toast-undo" data-action="undo-delete">元に戻す</button>`:""}`;el.classList.toggle("has-undo",undo);el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.classList.remove("show","has-undo");if(undo)undoSnapshot=null;},undo?8000:3700);}
// A delete can be undone until the next change is saved; the snapshot restores everything at once.
function deleteWithUndo(change,message){const before=JSON.stringify(state);mutate(change);undoSnapshot=before;flash(message,true);}
function undoDelete(){if(!undoSnapshot)return;state=JSON.parse(undoSnapshot);undoSnapshot=null;applyTheme();render();save();flash("元に戻しました");}
function save(){
  undoSnapshot=null;
  // Which edition saved last lets a JSON import warn when it would overwrite newer work.
  state.meta={...(state.meta||{}),edition:window.__todoBrowserMode?"edge":"exe",savedAt:localTimestamp()};
  const snapshot=JSON.parse(JSON.stringify(state));
  $("#save-status").textContent="保存中…";
  saveChain=saveChain.catch(()=>{}).then(()=>api("/api/state","PUT",snapshot)).then(()=>{browserLastSaveError=null;$("#save-status").textContent="自動保存済み";return true;}).catch(error=>{browserLastSaveError=error;$("#save-status").textContent="保存エラー";const note=$("#browser-save-note");if(note){note.textContent="自動保存に失敗しました。編集中の内容はJSONにバックアップしてください。";note.classList.add("browser-error");}flash(`保存できませんでした: ${error.message}`);return false;});
  return saveChain;
}
function mutate(fn,message){fn();render();save();if(message)flash(message);}
async function saveSettingsChange(change,message){
  if(settingsBusy)return false;
  settingsBusy=true;
  await saveChain;
  const previous=JSON.parse(JSON.stringify(state));
  try{change();render();applyTheme();if(!await save())throw new Error("設定を保存できませんでした");flash(message);return true;}
  catch(error){state=previous;render();applyTheme();$("#save-status").textContent="保存エラー";flash(`設定を元に戻しました: ${error.message}`);return false;}
  finally{settingsBusy=false;render();applyTheme();}
}
function title(eyebrow,name,desc="",actions=""){return `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(name)}</h1>${desc?`<p>${esc(desc)}</p>`:""}</div>${actions?`<div class="heading-actions">${actions}</div>`:""}</div>`;}
function button(action,label,kind="secondary",extra=""){return `<button class="${kind}" data-action="${action}" ${extra}>${esc(label)}</button>`;}
function noItems(message){return `<div class="empty">${esc(message)}</div>`;}
function stat(label,value,suffix="",foot=""){return `<div class="card stat"><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(value)}</span><span class="stat-suffix">${esc(suffix)}</span>${foot?`<div class="stat-foot">${esc(foot)}</div>`:""}</div>`;}

function heroCopy(){
  if(garoMode())return {eyebrow:"GOLDEN KNIGHT MODE",title:"積み上げた一件一件が、黄金の出玉になる。"};
  if(uiTheme()==="dozle")return {eyebrow:"TODAY'S QUEST",title:"今日のタスクも、最速クリアでいこう。"};
  return {eyebrow:"LEADER'S WORKSPACE",title:"チームの今日を、見通しよく。"};
}
function homeView(){
  const early=countShift("early"),late=countShift("late"),open=pendingTodos(),next=open[0];
  const records=allRecords();
  const dueToday=open.filter(t=>dateKey(t.dueDate) && dateKey(t.dueDate)<=today()).length;
  const percent=(done,total)=>total?Math.round(done/total*100):0;
  return `<div class="hero"><div><div class="eyebrow" id="hero-eyebrow">${esc(heroCopy().eyebrow)}</div><h1 id="hero-title">${esc(heroCopy().title)}</h1><p>${esc(formatDate(today(),{year:"numeric",month:"long",day:"numeric",weekday:"long"}))}　未完了の TODO ${open.length} 件</p></div>${uiTheme()==="dozle"&&typeof dozleHero==="function"?dozleHero():""}<button data-view="checklist">${garoMode()?"勝負開始 ▸ 日次チェック":"日次チェックを開く →"}</button></div>${garoChampion(["early","late"])}
    <div class="stats">${stat("早番チェック",`${early.done} / ${early.total}`,"件",`${percent(early.done,early.total)}% 完了`)}${stat("遅番チェック",`${late.done} / ${late.total}`,"件",`${percent(late.done,late.total)}% 完了`)}${stat("自由 TODO",open.length,"件",`${dueToday} 件が今日まで`)}${stat("リーダー記録",records.length,"件",`${new Set(records.map(r=>dateKey(r.recordedAt))).size} 日に記録`)}</div>
    <div class="grid-two"><div class="stack"><section class="card"><div class="card-header"><h2>次に取り組む TODO</h2><button class="icon-button" data-view="todos">すべて見る →</button></div><div class="card-body">${next?`<div class="task-line"><div><div class="task-title">${esc(next.text)}</div><div class="meta" style="margin-top:6px">${esc(next.owner||"担当未設定")} · ${esc(formatDate(next.dueDate))}</div></div><span class="badge ${cssBadge(dateKey(next.dueDate))}">${esc(dueLabel(dateKey(next.dueDate)))}</span></div>`:noItems("未完了の TODO はありません")}<ul class="list-clean">${open.slice(1,5).map(t=>`<li class="task-line"><span>${esc(t.text)}</span><span class="meta">${esc(formatDate(t.dueDate))}</span></li>`).join("")}</ul></div></section>
    <section class="card"><div class="card-header"><h2>チェックの進み具合</h2><button class="icon-button" data-view="checklist">開く →</button></div><div class="card-body">${[["早番",early],["遅番",late]].map(([name,c])=>`<div class="progress-row"><span class="progress-label">${name}</span><div class="progress-track"><div class="progress-fill" style="width:${percent(c.done,c.total)}%"></div></div><span class="progress-count">${c.done}/${c.total}</span></div>`).join("")}${homeLateChecks()}</div></section></div>
    <div class="stack"><section class="card"><div class="card-header"><h2>最近の記録</h2><button class="icon-button" data-view="records">記録を見る →</button></div><div class="card-body"><ul class="list-clean">${records.slice(0,3).map(r=>`<li><div class="meta">${esc(formatDate(r.recordedAt))} · ${esc(r.author||"記載者不明")}</div><div class="task-title" style="margin-top:5px;line-height:1.55">${esc(String(r.text||"").slice(0,82))}${String(r.text||"").length>82?"…":""}</div></li>`).join("")||noItems("まだ記録がありません")}</ul></div></section>
    <section class="card"><div class="card-header"><h2>データ管理</h2></div><div class="card-body"><p class="note">入力内容はこのパソコンに自動保存されます。3人で共有するときは「共有用に書き出す」でJSONを作り、受け取ったJSONを「共有データを取り込む」で合わせます（どちらの記録も消えません）。</p><div class="heading-actions" style="justify-content:flex-start">${button("export-data","共有用に書き出す","primary")}${button("merge-data","共有データを取り込む")}${button("import-excel","Excel から取り込む")}</div></div></section></div></div>`;
}

function homeLateChecks(){
  const late=[...lateChecks("early").map(item=>["早番",item]),...lateChecks("late").map(item=>["遅番",item])];
  if(!late.length)return "";
  return `<div class="home-late"><strong>時刻を過ぎた未チェック ${late.length} 件</strong><ul class="list-clean">${late.slice(0,5).map(([name,item])=>`<li><span class="time-pill">${esc(String(item.time).slice(0,5))}</span> ${esc(name)} · ${esc(item.text)}</li>`).join("")}</ul>${late.length>5?`<span class="meta">ほか ${late.length-5} 件</span>`:""}</div>`;
}
function checklistView(){
  const items=state.shiftSections?.[shift]||[];
  const count=countShift(shift),groups=[];let group={heading:"開始前",note:"",items:[]};
  for(const item of items){if(item.kind==="H"){if(group.items.length||group.heading!=="開始前")groups.push(group);group={heading:item.text||"",note:item.note||"",items:[]};}else group.items.push(item);}
  if(group.items.length)groups.push(group);
  const renderItem=(item)=>{
    if(item.kind==="N")return `<div class="detail" style="margin:9px 11px">${esc(item.text)}${item.note?`<br>${esc(item.note)}`:""}</div>`;
    if(item.kind==="I")return `<div class="check-row"><div class="check-text"><strong>${esc(item.text)}</strong><small>${esc(item.note||"")}</small></div></div>`;
    const checked=!!item.completed;
    const late=isLateCheck(item);
    return `<div class="check-row ${checked?"checked":""} ${late?"late-check":""}"><input type="checkbox" data-action="toggle-check" data-shift="${shift}" data-id="${esc(item.id)}" aria-label="${esc(item.text)}" ${checked?"checked":""}><div class="check-text"><strong>${esc(item.text)}</strong>${item.note?`<small>${esc(item.note)}</small>`:""}</div>${item.time?`<span class="time-pill">${esc(String(item.time).slice(0,5))}</span>`:""}${late?`<span class="badge overdue">${garoMode()?"時刻超過・激アツ":"時刻超過"}</span>`:""}${item.url?`<button class="icon-button" data-action="open-link" data-url="${esc(item.url)}" aria-label="${esc(item.text)}のリンクを開く">↗</button>`:""}</div>`;
  };
  const heading=title("DAILY CHECKLIST","日次チェック","早番・遅番の項目をその場で確認。変更は自動保存されます。",button("toggle-checklist-edit",checklistEditing?"編集を終える":"項目を編集",checklistEditing?"primary":"secondary")+(checklistEditing?"":button("print-checklist","印刷")+button("reset-checks","チェックをリセット")));
  const tabs=`<div class="tabs"><button class="tab ${shift==="early"?"active":""}" data-action="shift" data-value="early">早番 ${countShift("early").done}/${countShift("early").total}</button><button class="tab ${shift==="late"?"active":""}" data-action="shift" data-value="late">遅番 ${countShift("late").done}/${countShift("late").total}</button></div>`;
  if(checklistEditing)return heading+tabs+checklistEditorView();
  const champion=garoChampion([shift]);
  const late=lateChecks(shift).length;
  return heading+
    `${champion}<div class="tabs"><button class="tab ${shift==="early"?"active":""}" data-action="shift" data-value="early">早番 ${countShift("early").done}/${countShift("early").total}</button><button class="tab ${shift==="late"?"active":""}" data-action="shift" data-value="late">遅番 ${countShift("late").done}/${countShift("late").total}</button></div><div class="card"><div class="card-header"><h2>${shift==="early"?"早番":"遅番"}のタスク</h2><span class="card-header-badges">${late?`<span class="badge overdue">時刻超過 ${late} 件</span>`:""}<span class="badge done">${count.done}/${count.total} 完了</span></span></div><div class="card-body">${groups.map(g=>`<section class="check-group"><div class="group-title"><span>${esc(g.heading)}</span><small>${esc(g.note)}</small></div>${g.items.map(renderItem).join("")}</section>`).join("")}</div></div>${checkHistoryView()}`;
}

function archiveView(){
  const archive=(state.todoArchive||[]).filter(t=>!todoSearch||`${t.text} ${t.owner}`.toLocaleLowerCase().includes(todoSearch.toLocaleLowerCase())).sort((a,b)=>String(b.archivedAt||"").localeCompare(String(a.archivedAt||"")));
  return `<section class="card">${archive.length?archive.map(t=>`<div class="todo-row completed"><span class="badge done">保管</span><div class="todo-main"><div class="todo-name">${esc(t.text)}</div><div class="todo-info">${esc(t.owner||"担当未設定")} · ${t.dueDate?`期日 ${esc(formatDate(t.dueDate))}`:"期日なし"} · ${t.completedAt?`完了 ${esc(formatDate(t.completedAt,{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}))} · `:""}保管 ${esc(formatDate(t.archivedAt,{year:"numeric",month:"numeric",day:"numeric"}))}${t.archivedReason?` · ${esc(t.archivedReason)}`:""}</div></div><div class="row-actions"><button class="icon-button" data-action="restore-todo" data-id="${esc(t.id)}">未完了に戻す</button></div></div>`).join(""):noItems("保管済みの TODO はありません")}</section>`;
}
function todosView(){
  const owners=ownerChoices();
  const archived=(state.todoArchive||[]).length;
  const categories=todoCategories();
  if(todoCategory&&!categories.includes(todoCategory))todoCategory="";
  const list=[...(state.todos||[])].filter(t=>(todoFilter==="all"|| (todoFilter==="open"?!t.completed:t.completed)) && (!todoCategory||t.category===todoCategory) && (!todoSearch||`${t.text} ${t.owner} ${t.category||""}`.toLocaleLowerCase().includes(todoSearch.toLocaleLowerCase()))).sort((a,b)=>(Number(a.completed)-Number(b.completed))||byPriorityAndDue(a,b));
  return title("TASKS","自由 TODO","担当・期日で管理します。期日を付けた項目はカレンダーにも表示されます。")+
    `<section class="card"><div class="card-header"><h2>TODO を追加</h2></div><div class="card-body"><form id="todo-add" class="form-grid"><div class="field"><label for="todo-text">内容</label><input id="todo-text" name="text" required maxlength="250" placeholder="やることを入力"></div><div class="field"><label for="todo-due">期日</label><input id="todo-due" name="due" type="date"></div><div class="field"><label for="todo-owner">担当</label><input id="todo-owner" name="owner" list="owners-list" value="${esc(defaultTodoOwner())}" placeholder="担当者"><datalist id="owners-list">${owners.map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist></div><div class="field"><label for="todo-repeat">繰り返し</label><select id="todo-repeat" name="repeat">${repeatOptions("")}</select></div><div class="field"><label for="todo-priority">優先度</label><select id="todo-priority" name="priority">${priorityOptions("")}</select></div><div class="field"><label for="todo-category">分類</label><input id="todo-category" name="category" maxlength="30" list="todo-categories" placeholder="例: 設備・書類"><datalist id="todo-categories">${todoCategories().map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist></div><button class="primary" type="submit">追加する</button></form><p class="note todo-repeat-note">繰り返しを選ぶと、完了にした時点で次回分を自動で追加します（期日が必要です）。毎月の場合、内容の「○月」も1か月進めます。</p></div></section>
    <div class="filterbar"><input class="search-input" id="todo-search" placeholder="TODO を検索" value="${esc(todoSearch)}" aria-label="TODO を検索"><select id="todo-filter" class="search-input" aria-label="状態で絞り込む"><option value="open" ${todoFilter==="open"?"selected":""}>未完了</option><option value="all" ${todoFilter==="all"?"selected":""}>すべて</option><option value="done" ${todoFilter==="done"?"selected":""}>完了</option><option value="archive" ${todoFilter==="archive"?"selected":""}>保管済み（${archived}）</option></select>${categories.length?`<select id="todo-category-filter" class="search-input" aria-label="分類で絞り込む"><option value="">すべての分類</option>${categories.map(name=>`<option value="${esc(name)}" ${todoCategory===name?"selected":""}>${esc(name)}</option>`).join("")}</select>`:""}<span class="meta">${todoFilter==="archive"?`保管 ${archived} 件`:`${list.length} 件`}</span></div>${todoFilter==="archive"?archiveView():`<section class="card">${list.length?list.map(t=>`<div class="todo-row tier-${t.priority||"normal"} ${t.completed?"completed":""}"><input type="checkbox" data-action="toggle-todo" data-id="${esc(t.id)}" aria-label="${esc(t.text)}を完了" ${t.completed?"checked":""}><div class="todo-main"><div class="todo-name">${priorityLabels[t.priority]?`<span class="priority-tag priority-${t.priority}">${priorityLabels[t.priority]}</span>`:""}${esc(t.text)}</div><div class="todo-info">${esc(t.owner||"担当未設定")} · ${esc(formatDate(t.dueDate))}${t.category?` · <span class="category-tag">${esc(t.category)}</span>`:""}${repeatLabels[t.repeat]?` · <span class="repeat-tag">↻ ${repeatLabels[t.repeat]}</span>`:""}</div></div><span class="badge ${cssBadge(dateKey(t.dueDate),t.completed)}">${esc(dueLabel(dateKey(t.dueDate),t.completed))}</span><div class="row-actions"><button class="icon-button" data-action="edit-todo" data-id="${esc(t.id)}">編集</button><button class="icon-button" data-action="delete-todo" data-id="${esc(t.id)}">削除</button></div></div>`).join(""):noItems("条件に一致する TODO はありません")}</section>`}`;
}

function calendarSideView(selected){
  const selectedTasks=(state.todos||[]).filter(t=>dateKey(t.dueDate)===selected);
  const entries=state.settings?.calendarEntries||[];
  const selectedOther=entries.filter(e=>dateKey(e.date)===selected);
  return `<section class="card calendar-side"><div class="card-header"><div><span class="meta">選択中の日付</span><h2>${esc(formatDate(selected,{year:"numeric",month:"long",day:"numeric",weekday:"long"}))}</h2></div><div class="calendar-header-actions"><button class="soft-button" data-action="add-calendar-entry" data-date="${esc(selected)}">予定を追加</button><button class="soft-button" data-action="add-on-day" data-date="${esc(selected)}">TODO を追加</button></div></div><div class="card-body">${selectedTasks.length?`<ul class="list-clean">${selectedTasks.map(t=>`<li class="task-line calendar-task" data-calendar-todo-id="${esc(t.id)}" title="ダブルクリックで編集"><span class="${t.completed?"muted":""}">${esc(t.text)}<small class="meta"> · ${esc(t.owner||"担当未設定")}</small></span><span class="calendar-task-actions"><span class="badge ${t.completed?"done":""}">${t.completed?"完了":"未完了"}</span><button class="icon-button" type="button" data-action="edit-todo" data-id="${esc(t.id)}">編集</button></span></li>`).join("")}</ul>`:noItems("この日の TODO はありません")}${selectedOther.length?`<div class="calendar-entries">${selectedOther.map(e=>`<div class="calendar-entry detail" data-calendar-entry-id="${esc(e.id)}" title="ダブルクリックで編集"><span>${esc(e.text).replaceAll("\n","<br>")}</span><button type="button" class="icon-button" data-action="edit-calendar-entry" data-id="${esc(e.id)}">編集</button></div>`).join("")}</div>`:""}<p class="note calendar-help">TODO・予定をダブルクリックで編集。日付の空白部分をダブルクリックすると、その日の編集対象を開きます。</p></div></section>`;
}
function selectCalendarDay(day,button,immediate=false){
  calendarSelectedDate=day;
  const previous=$(".calendar-grid .day.selected");
  if(previous){previous.classList.remove("selected");previous.setAttribute("aria-pressed","false");previous.setAttribute("aria-label",previous.getAttribute("aria-label").replace("、選択中",""));}
  button.classList.add("selected");
  button.setAttribute("aria-pressed","true");
  if(!button.getAttribute("aria-label").includes("、選択中"))button.setAttribute("aria-label",button.getAttribute("aria-label").replace("、TODO","、選択中、TODO"));
  clearTimeout(calendarSideTimer);
  const updateSide=()=>{if(currentView==="calendar"&&calendarSelectedDate===day){const side=$(".calendar-side");if(side)side.outerHTML=calendarSideView(day);}};
  if(immediate)updateSide();
  else calendarSideTimer=setTimeout(updateSide,380);
}
function calendarView(){
  const year=calendarMonth.getFullYear(),month=calendarMonth.getMonth(),first=new Date(year,month,1),start=new Date(year,month,1-first.getDay());
  const all=[...(state.todos||[])].filter(t=>t.dueDate);
  const entries=state.settings?.calendarEntries||[];
  const selected=calendarSelectedDate||today();
  const cells=Array.from({length:42},(_,i)=>{const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i),key=localKey(d),tasks=all.filter(t=>dateKey(t.dueDate)===key),other=entries.filter(e=>dateKey(e.date)===key);
    return `<button class="day ${d.getMonth()!==month?"outside":""} ${key===today()?"today":""} ${key===selected?"selected":""}" data-action="select-day" data-date="${key}" aria-pressed="${key===selected}" aria-label="${esc(formatDate(key,{year:"numeric",month:"long",day:"numeric",weekday:"long"}))}${key===selected?"、選択中":""}、TODO ${tasks.length}件"><span class="day-num">${d.getDate()}</span>${tasks.slice(0,2).map(t=>`<span class="day-chip ${t.completed?"completed":""}" data-todo-id="${esc(t.id)}" title="ダブルクリックで編集">${esc(t.text)}</span>`).join("")}${other.slice(0,1).map(e=>`<span class="day-chip" data-entry-id="${esc(e.id)}" title="ダブルクリックで編集">${esc(String(e.text||"").split("\n")[0])}</span>`).join("")}${tasks.length+other.length>3?`<span class="day-more">ほか ${tasks.length+other.length-3} 件</span>`:""}</button>`;}).join("");
  return title("CALENDAR","カレンダー","日付を選択できます。TODO をダブルクリックすると編集できます。")+
    `<section class="card"><div class="card-body"><div class="calendar-top"><h2>${year}年 ${month+1}月</h2><div class="calendar-controls"><button class="secondary" data-action="month-prev" aria-label="前月">‹</button><button class="secondary" data-action="month-today">今月</button><button class="secondary" data-action="month-next" aria-label="翌月">›</button></div></div><div class="calendar-grid">${["日","月","火","水","木","金","土"].map(w=>`<div class="weekday">${w}</div>`).join("")}${cells}</div></div></section>${calendarSideView(selected)}`;
}

function recordsView(){
  const records=allRecords().filter(r=>!recordSearch||`${r.text} ${r.author}`.toLocaleLowerCase().includes(recordSearch.toLocaleLowerCase()));
  const draft=(state.settings?.reflectionDrafts||[])[0]||{text:"",author:""};
  return title("RECORDS","リーダー記録","気づきや引継ぎを残し、あとで検索できます。",button("report-weekly","週次レポート","secondary")+button("report-monthly","月次レポート","secondary")+button("daily-update","日次更新を実行","primary"))+
    `<div class="grid-two"><div class="stack"><section class="card"><div class="card-header"><h2>記録を追加</h2></div><div class="card-body"><form id="record-add" class="dialog-fields"><div class="field"><label for="record-text">内容</label><textarea id="record-text" name="text" required placeholder="今日の気づき・共有事項"></textarea></div><div class="field"><label for="record-author">記載者</label><input id="record-author" name="author" required list="record-owners" placeholder="名前" value="${esc(currentUser())}"><datalist id="record-owners">${ownerChoices().map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist></div><div>${button("","記録する","primary","type=submit")}</div></form></div></section>
    <section class="card"><div class="card-header"><h2>次の日次更新で記録するメモ</h2></div><div class="card-body"><form id="draft-form" class="dialog-fields"><div class="field"><label for="draft-text">引継ぎ・振り返り</label><textarea id="draft-text" name="text">${esc(draft.text)}</textarea></div><div class="field"><label for="draft-author">記載者</label><input id="draft-author" name="author" list="record-owners" value="${esc(draft.author||currentUser())}"></div><div><button class="secondary" type="submit">メモを保存</button></div></form><p class="note">日次更新では、このメモをリーダー記録へ移し、日次チェックの結果を実施記録に残してからリセットし、完了した自由 TODO を「保管済み」へ移します。</p></div></section></div>
    <div><div class="filterbar" style="margin-top:0"><input class="search-input" id="record-search" placeholder="記録を検索" value="${esc(recordSearch)}" aria-label="記録を検索"><span class="meta">${records.length} 件</span></div>${recordShowTrash?recordTrashView():`<section class="card">${records.length?records.map(r=>`<article class="record"><div class="record-head"><span class="author">${esc(r.author||"記載者不明")}</span><span>${esc(formatDate(r.recordedAt,{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}))}${r.editedAt?`<small class="meta">（編集済み）</small>`:""}</span></div><p>${esc(r.text)}</p><div class="record-actions"><button type="button" class="icon-button" data-action="edit-record" data-id="${esc(r.id)}">編集</button><button type="button" class="icon-button" data-action="delete-record" data-id="${esc(r.id)}">削除</button></div></article>`).join(""):noItems("記録がありません")}</section>`}${(state.recordTrash||[]).length?`<button type="button" class="text-button record-trash-toggle" data-action="toggle-record-trash">${recordShowTrash?"記録の一覧に戻る":`削除した記録（${state.recordTrash.length} 件）を表示`}</button>`:""}</div></div>`;
}

function recordTrashView(){
  const trash=[...(state.recordTrash||[])].sort((a,b)=>String(b.deletedAt||"").localeCompare(String(a.deletedAt||"")));
  return `<section class="card"><div class="card-header"><h2>削除した記録</h2><span class="meta">${trash.length} 件</span></div>${trash.map(r=>`<article class="record"><div class="record-head"><span class="author">${esc(r.author||"記載者不明")}</span><span>${esc(formatDate(r.recordedAt,{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}))} · 削除 ${esc(formatDate(r.deletedAt,{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}))}</span></div><p>${esc(r.text)}</p><div class="record-actions"><button type="button" class="icon-button" data-action="restore-record" data-id="${esc(r.id)}">記録に戻す</button></div></article>`).join("")||noItems("削除した記録はありません")}</section>`;
}
function editRecord(id){
  const record=byId(state.records||[],id);if(!record)return;
  const at=String(record.recordedAt||"");
  openDialog(`<h2>リーダー記録を編集</h2><div class="dialog-fields"><div class="field"><label for="edit-record-at">記録日時</label><input id="edit-record-at" name="at" type="datetime-local" required value="${esc(at.slice(0,16))}"></div><div class="field"><label for="edit-record-author">記載者</label><input id="edit-record-author" name="author" required maxlength="40" list="edit-record-owners" value="${esc(record.author||"")}"><datalist id="edit-record-owners">${ownerChoices().map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist></div><div class="field"><label for="edit-record-text">内容</label><textarea id="edit-record-text" name="text" required>${esc(record.text||"")}</textarea></div></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">保存</button></div>`,data=>{
    const text=String(data.get("text")||"").trim(),author=String(data.get("author")||"").trim(),nextAt=String(data.get("at")||"");
    if(!text||!author||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(nextAt)){flash("記録日時・記載者・内容を入力してください");return false;}
    mutate(()=>{record.recordedAt=nextAt===at.slice(0,16)?at:`${nextAt}:00`;record.author=author;record.text=text;record.editedAt=localTimestamp();},"記録を更新しました");
  });
}
function hpView(){
  const stores=state.hpStores||[];
  const browser=!!window.__todoBrowserMode;
  const description=browser?"保存した店舗ページのHTMLから画像URLを抽出し、前回と比較します。":"各店舗ページの画像 URL を手動で取得し、前回の保存内容と比較します。";
  return title("WEB MONITOR","HP 画像チェック",description,browser?"":button("check-all-hp","全店舗を確認","primary"))+
    `<section class="card"><div class="hp-row head"><span>店舗</span><span>状態</span><span>画像</span><span>最終確認</span><span>操作</span></div>${stores.map(s=>`<div class="hp-row"><div><strong>${esc(s.name)}</strong><small>${esc(s.detail||s.change||"")}</small>${s.checkError?`<small class="error">${esc(s.checkError)}</small>`:""}${browser&&Array.isArray(s.lastImportedDiff?.added)&&Array.isArray(s.lastImportedDiff?.removed)?`<details class="hp-diff"><summary>追加 ${s.lastImportedDiff.added.length}・削除 ${s.lastImportedDiff.removed.length} のURL</summary><div><strong>追加</strong><ul>${s.lastImportedDiff.added.map(url=>`<li>${esc(url)}</li>`).join("")||"<li>なし</li>"}</ul><strong>削除</strong><ul>${s.lastImportedDiff.removed.map(url=>`<li>${esc(url)}</li>`).join("")||"<li>なし</li>"}</ul></div></details>`:""}</div><span class="badge ${s.status==="変更あり"?"today":s.status==="確認失敗"?"overdue":"done"}">${esc(s.status||"未確認")}</span><span>${esc(s.imageCount??"–")} 枚</span><span class="meta">${esc(s.checkedAt?formatDate(s.checkedAt,{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"未確認")}</span><span class="row-actions"><button class="secondary" data-action="check-hp" data-id="${esc(s.id)}">${browser?"保存HTMLを比較":"確認"}</button>${s.url?`<button class="icon-button" data-action="open-link" data-url="${esc(s.url)}">開く ↗</button>`:""}</span></div>`).join("")}</section><p class="note">${browser?"各店舗の「開く」からページを開き、Edgeの「名前を付けて保存」で「Webページ、HTMLのみ」を選んで保存してください。その店舗の「保存HTMLを比較」からファイルを選びます。画像そのものの変更や後から読み込まれる画像は検出できない場合があります。":"サイト側のアクセス制限やページ構造の変更により、画像を取得できないことがあります。その場合は店舗ごとにエラーを表示し、前回の画像一覧を残します。"}</p>`;
}

const departmentOf = link => String(link.department||"").trim()||"未分類";
const webLink = url => /^https?:\/\//i.test(String(url||""));
// Whether the document links can be found is checked by the desktop host and cached per base folder
// and link list; the screen re-renders once when a new answer arrives.
let linkStatusCache={key:"",value:null,pending:""};
function linkStatusFor(links){
  if(window.__todoBrowserMode)return null;
  const payload={base:state.settings?.linkBaseDir||"",links:links.map(l=>({label:l.label,url:l.url}))};
  const key=JSON.stringify(payload);
  if(linkStatusCache.key===key)return linkStatusCache.value;
  if(linkStatusCache.pending!==key){
    linkStatusCache.pending=key;
    api("/api/link-status","POST",payload).then(value=>{
      if(linkStatusCache.pending!==key)return;
      linkStatusCache={key,value,pending:""};
      const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||"");
      if(currentView==="references"&&!document.querySelector("dialog[open]")&&!typing)render();
    }).catch(()=>{if(linkStatusCache.pending===key)linkStatusCache.pending="";});
  }
  return null;
}
function referencesView(){
  const links=(state.referenceLinks||[]).filter(l=>l.url);
  const departments=[...new Set(links.map(departmentOf))].sort((a,b)=>a==="未分類"?1:b==="未分類"?-1:a.localeCompare(b,"ja"));
  const active=referenceDepartment===""||departments.includes(referenceDepartment)?referenceDepartment:"";
  const query=referenceSearch.toLocaleLowerCase();
  const shown=links.filter(l=>(active===""||departmentOf(l)===active)&&(!query||`${l.label} ${l.url} ${departmentOf(l)}`.toLocaleLowerCase().includes(query)));
  const grouped=shown.reduce((result,link)=>{(result[departmentOf(link)]??=[]).push(link);return result;},Object.create(null));
  const support=(state.settings?.supplementaryCells||[]).filter(x=>/^Q(4[5-9]|5[0-9]|6[0-2])$/.test(x.sourceCell)&&x.value).slice(0,18);
  const base=state.settings?.linkBaseDir||"未設定（D:\\ を基準にします）";
  const status=linkStatusFor(links);
  const statusText=!status?"":status.total===0?"":status.ok===status.total?`<p class="note">文書リンク ${status.total} 件すべて開けます。</p>`:
    `<p class="note error">文書リンク ${status.total} 件中 ${status.total-status.ok} 件の参照先が見つかりません。元のExcel（ハイパーリンクを設定していたブック）が置かれているフォルダーを選んでください。</p><details><summary>見つからないリンク</summary><ul>${status.missing.map(name=>`<li>${esc(name)}</li>`).join("")}</ul></details>`;
  return title("REFERENCES","関連リンク","Webページや業務文書を部門別に整理できます。",button("add-reference","＋ リンクを追加","primary"))+
    `<section class="card reference-settings"><div><strong>既存文書リンクの基準フォルダー</strong><small>${esc(base)}</small><p class="note">このPCで、ハイパーリンクを設定していたExcelファイルが置かれているフォルダーを選んでください。そのExcelを「Excel から取り込む」で読み込むと自動で設定されます。Webリンクには影響しません。</p>${statusText}</div>${button("choose-link-base-dir","フォルダーを選ぶ")}</section>`+
    `<div class="filterbar reference-filters"><label for="reference-department">部門</label><select id="reference-department" class="search-input"><option value="" ${active===""?"selected":""}>すべての部門</option>${departments.map(name=>`<option value="${esc(name)}" ${active===name?"selected":""}>${esc(name)}</option>`).join("")}</select><input id="reference-search" class="search-input" value="${esc(referenceSearch)}" placeholder="名前・URLを検索" aria-label="関連リンクを検索"><span class="meta">${shown.length} / ${links.length} 件</span></div>`+
    (shown.length?departments.filter(name=>grouped[name]).map(name=>`<section class="reference-section"><div class="section-head"><h2>${esc(name)} <span class="meta">${grouped[name].length} 件</span></h2><button class="icon-button" data-action="rename-department" data-department="${esc(name)}">部門名を変更</button></div><div class="link-grid">${grouped[name].map(l=>`<div class="card link-card"><div class="link-card-heading"><strong>${esc(l.label||l.sourceCell||"リンク")}</strong><span class="badge">${webLink(l.url)?"Web":"文書"}</span></div><small title="${esc(l.url)}">${esc(l.url)}</small><div class="link-actions"><button data-action="open-link" data-url="${esc(l.url)}">開く ↗</button><button data-action="edit-reference" data-id="${esc(l.id)}">編集</button><button data-action="delete-reference" data-id="${esc(l.id)}">削除</button></div></div>`).join("")}</div></section>`).join(""):noItems("条件に一致するリンクはありません"))+
    (support.length?`<section><div class="section-head"><h2>業務メモ</h2></div><div class="card"><div class="card-body"><ul class="list-clean">${support.map(x=>`<li>${esc(x.value)}</li>`).join("")}</ul></div></div></section>`:"");
}

function settingsView(){
  const owners=ownerChoices(),selectedTheme=uiTheme(),defaultOwner=defaultTodoOwner(),initialView=startView();
  const browser=!!window.__todoBrowserMode;
  return title("PREFERENCES","設定","担当者の候補と、アプリの表示・新規入力を調整できます。")+
    `<div class="settings-layout"><div class="settings-stack"><section class="card"><div class="card-header"><h2>担当者リスト</h2><span class="meta">${owners.length} 名</span></div><div class="card-body"><p class="note settings-note">ここで変更するのは今後の入力候補です。過去のTODO・リーダー記録に保存された担当者名は変更しません。</p><form id="settings-add-owner" class="settings-add"><div class="field"><label for="settings-owner-name">担当者を追加</label><input id="settings-owner-name" name="owner" required maxlength="40" autocomplete="off" placeholder="名前を入力"></div><button class="primary" type="submit" ${settingsBusy?"disabled":""}>追加</button></form>${owners.length?`<ul class="settings-owner-list">${owners.map(name=>`<li class="settings-owner-row"><span class="settings-owner-icon" aria-hidden="true">${esc(name.slice(0,1))}</span><span class="settings-owner-name">${esc(name)}</span><span class="settings-owner-actions"><button type="button" class="icon-button" data-action="rename-owner" data-owner="${esc(name)}" ${settingsBusy?"disabled":""}>名前を変更</button><button type="button" class="icon-button" data-action="delete-owner" data-owner="${esc(name)}" ${settingsBusy?"disabled":""}>候補から削除</button></span></li>`).join("")}</ul>`:noItems("担当者の候補がありません。上から追加してください。")}</div></section></div>`+
    `<div class="settings-stack"><section class="card"><div class="card-header"><h2>新規入力と起動</h2></div><div class="card-body settings-fields"><div class="field"><label for="settings-me">このPCを使う人</label><select id="settings-me" ${settingsBusy?"disabled":""}><option value="">未設定</option>${owners.map(name=>`<option value="${esc(name)}" ${currentUser()===name?"selected":""}>${esc(name)}</option>`).join("")}</select><small class="note">記録の記載者の初期値と、共有用JSONのファイル名に使います。</small></div><div class="field"><label for="settings-default-owner">新しいTODOの既定担当</label><select id="settings-default-owner" ${settingsBusy?"disabled":""}><option value="">担当未設定</option>${owners.map(name=>`<option value="${esc(name)}" ${defaultOwner===name?"selected":""}>${esc(name)}</option>`).join("")}</select><small class="note">新規の自由TODO・カレンダーTODOにだけ適用します。</small></div><div class="field"><label for="settings-start-view">起動時に開く画面</label><select id="settings-start-view" ${settingsBusy?"disabled":""}>${startViewChoices.map(view=>`<option value="${view}" ${initialView===view?"selected":""}>${esc(labels[view])}</option>`).join("")}</select><small class="note">次にアプリを起動したときから適用します。</small></div></div></section>`+
    `<section class="card"><div class="card-header"><h2>キーボード操作</h2></div><div class="card-body"><p class="note settings-note">「/」で検索、「N」で新規追加、「Alt + 1〜8」で画面移動ができます。</p>${button("show-shortcuts","一覧を表示")}</div></section><section class="card"><div class="card-header"><h2>カラーテーマ</h2></div><div class="card-body"><div class="settings-theme-options" role="group" aria-label="カラーテーマ">${[["standard","標準","明るく落ち着いた配色"],["garo","黄金騎士","黒と金のパチンコ演出"],["dozle","ドズル社風","ブロックとドット絵のファンテーマ"]].map(([value,name,detail])=>`<button type="button" class="settings-theme-option ${selectedTheme===value?"active":""}" data-action="set-theme" data-theme="${value}" aria-pressed="${selectedTheme===value}"><strong>${name}</strong><small>${detail}</small></button>`).join("")}</div>${selectedTheme==="garo"?garoSettingsView():selectedTheme==="dozle"&&typeof dozleSettingsView==="function"?dozleSettingsView():""}</div></section>`+
    `<section class="card"><div class="card-header"><h2>データとバックアップ</h2></div><div class="card-body"><p class="note settings-note">入力は自動保存されます（保存先は下の「保存モード」に表示）。3人で共有するときは「共有用に書き出す」でJSONを作ってTeams・共有フォルダーなどで渡し、受け取った側は「共有データを取り込む」を使います。取り込みは足し合わせなので、自分の記録やTODOは消えません。</p><div class="settings-data-actions">${button("export-data","共有用に書き出す","primary")}${button("merge-data","共有データを取り込む")}${button("import-data","JSONで置き換える")}${browser?"":button("open-data-folder","保存先を開く")}</div>${storageView()}${shareHistoryView()}<p class="note settings-note" style="margin-top:15px">Excel で運用した期間の内容は、元の「最新TODO　EX.xlsm」と同じ形式のブックから取り込めます。日次チェック・自由 TODO・予定は Excel の内容に合わせ、リーダー記録は足りない分だけ追加します。</p><div class="settings-data-actions">${button("import-excel","Excel から取り込む","primary")}</div></div></section></div></div>`;
}

function ownerNameError(raw,oldName=""){
  const name=String(raw??"").trim();
  if(!name)return "担当者名を入力してください";
  if(name.length>40||/[\x00-\x1f\x7f]/.test(name))return "担当者名は40文字以内の通常の文字で入力してください";
  if(ownerChoices().some(item=>item!==oldName&&item.toLocaleLowerCase()===name.toLocaleLowerCase()))return "同じ担当者名がすでにあります";
  return "";
}
async function addOwner(raw){
  const error=ownerNameError(raw);if(error){flash(error);return false;}
  const name=String(raw).trim();
  return saveSettingsChange(()=>{state.owners=[...ownerChoices(),name];},`「${name}」を候補に追加しました`);
}
function renameOwner(oldName){
  if(!ownerChoices().includes(oldName))return;
  openDialog(`<h2>担当者名を変更</h2><div class="dialog-fields"><div class="field"><label for="rename-owner-name">新しい候補名</label><input id="rename-owner-name" name="owner" required maxlength="40" value="${esc(oldName)}"></div><p class="note">過去のTODOやリーダー記録の名前は変更しません。</p></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">変更を保存</button></div>`,async data=>{
    const next=String(data.get("owner")??"").trim();if(next===oldName)return true;
    const error=ownerNameError(next,oldName);if(error){flash(error);return false;}
    return saveSettingsChange(()=>{state.owners=ownerChoices().map(name=>name===oldName?next:name);if(state.settings.defaultTodoOwner===oldName)state.settings.defaultTodoOwner=next;if(state.settings.me===oldName)state.settings.me=next;},`候補名を「${next}」に変更しました`);
  });
}
async function deleteOwner(name){
  if(!ownerChoices().includes(name))return;
  if(!confirm(`「${name}」を今後の入力候補から削除しますか？\n過去のTODO・リーダー記録に保存された名前は残ります。`))return;
  await saveSettingsChange(()=>{state.owners=ownerChoices().filter(item=>item!==name);if(state.settings.defaultTodoOwner===name)state.settings.defaultTodoOwner="";if(state.settings.me===name)state.settings.me="";},`「${name}」を候補から削除しました`);
}

function render(){
  if(!state)return;
  if(typeof renderGaroVitals==="function")renderGaroVitals();
  main.classList.toggle("growth-page",currentView==="growth");
  $("#breadcrumb").textContent=labels[currentView];
  $("#today-label").textContent=formatDate(today(),{year:"numeric",month:"long",day:"numeric",weekday:"long"});
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===currentView));
  const views={home:homeView,checklist:checklistView,todos:todosView,calendar:calendarView,records:recordsView,growth:growthView,hp:hpView,references:referencesView,settings:settingsView};
  try{main.innerHTML=views[currentView]();}catch(error){main.innerHTML=`<div class="card card-body">画面を表示できません: ${esc(error.message)}</div>`;console.error(error);}
  if(currentView==="growth"&&typeof fitDollboxes==="function")fitDollboxes();
  if(typeof dozleMode==="function"&&dozleMode())dozlePixelHeadings();
}
function setView(view){if(!labels[view])return;currentView=view;location.hash=view;document.querySelector(".sidebar").classList.remove("open");render();main.focus();window.scrollTo(0,0);}
function openDialog(html,onSubmit){$("#dialog-content").innerHTML=html;$("#edit-form").onsubmit=async event=>{event.preventDefault();if(await onSubmit(new FormData(event.target))!==false&&dialog.open)dialog.close();};dialog.showModal();}

function editTodo(id){const todo=byId(state.todos,id);if(!todo)return;openDialog(`<h2>TODO を編集</h2><div class="dialog-fields"><div class="field"><label>内容</label><input name="text" required maxlength="250" value="${esc(todo.text)}"></div><div class="field"><label>期日</label><input name="due" type="date" value="${esc(dateKey(todo.dueDate))}"></div><div class="field"><label for="dialog-todo-owner">担当</label><select id="dialog-todo-owner" name="owner">${ownerOptions(todo.owner)}</select></div><div class="field"><label for="dialog-todo-repeat">繰り返し</label><select id="dialog-todo-repeat" name="repeat">${repeatOptions(todo.repeat||"")}</select></div><div class="field"><label for="dialog-todo-priority">優先度</label><select id="dialog-todo-priority" name="priority">${priorityOptions(todo.priority||"")}</select></div><div class="field"><label for="dialog-todo-category">分類</label><input id="dialog-todo-category" name="category" maxlength="30" list="dialog-todo-categories" value="${esc(todo.category||"")}"><datalist id="dialog-todo-categories">${todoCategories().map(x=>`<option value="${esc(x)}"></option>`).join("")}</datalist></div></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">保存</button></div>`,data=>{const repeat=repeatLabels[data.get("repeat")]?String(data.get("repeat")):null;if(repeat&&!data.get("due")){flash("繰り返す TODO には期日を入れてください");return false;}mutate(()=>{todo.text=String(data.get("text")||"").trim();const due=String(data.get("due")||"")||null;if(repeat!==todo.repeat||due!==dateKey(todo.dueDate))delete todo.repeatDay;todo.dueDate=due;todo.owner=String(data.get("owner")||"").trim()||null;applyTodoExtras(todo,data);touch(todo);if(repeat)todo.repeat=repeat;else{delete todo.repeat;delete todo.repeatDay;}if(currentView==="calendar"&&todo.dueDate){calendarSelectedDate=dateKey(todo.dueDate);calendarMonth=new Date(`${calendarSelectedDate}T00:00:00`);}},"TODO を更新しました");});}
function applyTodoExtras(todo,data){
  const priority=String(data.get("priority")||""),category=String(data.get("category")||"").trim().slice(0,30);
  if(priorityLabels[priority])todo.priority=priority;else delete todo.priority;
  if(category)todo.category=category;else delete todo.category;
}
function addOnDay(day){openDialog(`<h2>${esc(formatDate(day,{year:"numeric",month:"long",day:"numeric"}))}に TODO を追加</h2><div class="dialog-fields"><div class="field"><label>内容</label><input name="text" required maxlength="250"></div><div class="field"><label for="dialog-todo-owner">担当</label><select id="dialog-todo-owner" name="owner">${ownerOptions(defaultTodoOwner())}</select></div></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">追加</button></div>`,data=>mutate(()=>{state.todos.push(touch({id:uid(),text:String(data.get("text")||"").trim(),dueDate:day,owner:String(data.get("owner")||"").trim()||null,completed:false}));},"TODO を追加しました"));}
function editCalendarEntry(id){
  const entry=byId(state.settings?.calendarEntries||[],id);
  if(!entry)return;
  openDialog(`<h2>予定を編集</h2><div class="dialog-fields"><div class="field"><label>日付</label><input name="date" type="date" required value="${esc(dateKey(entry.date))}"></div><div class="field"><label>内容</label><textarea name="text" required>${esc(entry.text)}</textarea></div></div><div class="dialog-actions"><button class="danger-link" type="button" data-action="delete-calendar-entry" data-id="${esc(entry.id)}">この予定を削除</button><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">保存</button></div>`,data=>mutate(()=>{entry.date=String(data.get("date")||"");entry.text=String(data.get("text")||"").trim();touch(entry);calendarSelectedDate=entry.date;calendarMonth=new Date(`${entry.date}T00:00:00`);},"予定を更新しました"));
}
function addCalendarEntry(day){
  openDialog(`<h2>${esc(formatDate(day,{year:"numeric",month:"long",day:"numeric"}))}に予定を追加</h2><div class="dialog-fields"><div class="field"><label>日付</label><input name="date" type="date" required value="${esc(day)}"></div><div class="field"><label>内容</label><textarea name="text" required></textarea></div></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">追加</button></div>`,data=>mutate(()=>{const date=String(data.get("date")||"");state.settings.calendarEntries??=[];state.settings.calendarEntries.push(touch({id:uid(),date,text:String(data.get("text")||"").trim()}));calendarSelectedDate=date;calendarMonth=new Date(`${date}T00:00:00`);},"予定を追加しました"));
}
function openCalendarDayEditor(day){
  const tasks=(state.todos||[]).filter(t=>dateKey(t.dueDate)===day);
  const entries=(state.settings?.calendarEntries||[]).filter(entry=>dateKey(entry.date)===day);
  if(tasks.length+entries.length===0){addOnDay(day);return;}
  if(tasks.length+entries.length===1){if(tasks.length)editTodo(tasks[0].id);else editCalendarEntry(entries[0].id);return;}
  openDialog(`<h2>${esc(formatDate(day,{year:"numeric",month:"long",day:"numeric"}))}の編集</h2><p class="note">編集する項目を選択してください。</p><div class="calendar-chooser">${tasks.map(t=>`<button type="button" class="secondary" data-action="calendar-edit-todo" data-id="${esc(t.id)}">TODO · ${esc(t.text)}</button>`).join("")}${entries.map(entry=>`<button type="button" class="secondary" data-action="edit-calendar-entry" data-id="${esc(entry.id)}">予定 · ${esc(String(entry.text||"").split("\n")[0])}</button>`).join("")}</div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">閉じる</button><button class="soft-button" type="button" data-action="add-calendar-entry" data-date="${esc(day)}">予定を追加</button><button class="primary" type="button" data-action="add-on-day" data-date="${esc(day)}">TODO を追加</button></div>`,()=>false);
}
async function checkHp(id){const s=byId(state.hpStores,id);if(!s)return;try{if(!window.__todoBrowserMode)await saveChain;const response=await api("/api/hp-check","POST",{storeId:id});if(response.cancelled)return;if(window.__todoBrowserMode){const previous=JSON.parse(JSON.stringify(state));const index=state.hpStores.findIndex(item=>item.id===id);state.hpStores[index]={...state.hpStores[index],...response.store};state.settings.hpCheck??={};state.settings.hpCheck.lastCheckedAt=response.store.checkedAt;render();if(!await save()){state=previous;render();throw new Error("保存できなかったため、比較結果を取り消しました");}}else{state.hpStores=response.state.hpStores;state.settings.hpCheck=response.state.settings.hpCheck;render();}flash(response.store.checkError?`${s.name}: ${response.store.checkError}`:`${s.name}の画像URLを比較しました`);}catch(error){flash(`${s.name}: ${error.message}`);}}
function dailyUpdate(){const drafts=(state.settings?.reflectionDrafts||[]).filter(x=>String(x.text||"").trim());if(drafts.some(x=>!String(x.author||"").trim())){flash("記録するメモの記載者を入力してください");setView("records");return;}const done=state.todos.filter(t=>t.completed).length;if(!confirm(`日次更新を実行します。\n記録へ移すメモ: ${drafts.length} 件\n保管済みへ移す完了 TODO: ${done} 件\n早番・遅番チェック: 実施記録に残してリセット\n続けますか？`))return;mutate(()=>{const now=localTimestamp();for(const d of drafts)state.records.push({id:uid(),recordedAt:now,author:d.author,text:d.text});state.settings.reflectionDrafts=[];state.settings.handover={text:"",author:""};state.todoArchive=[...(state.todoArchive||[]),...state.todos.filter(t=>t.completed).map(t=>({...t,archivedAt:now,archivedReason:"日次更新"}))];state.todos=state.todos.filter(t=>!t.completed);recordCheckHistory(now);for(const group of Object.values(state.shiftSections))for(const item of group)if(actionable(item))item.completed=false;state.settings.lastDailyUpdateAt=now;},"日次更新を実行しました");garoEvent("daily",{drafts:drafts.length});}
// One entry per daily update keeps what was done and what was left before the checks are reset.
function recordCheckHistory(at){
  const summary=name=>{const list=(state.shiftSections?.[name]||[]).filter(actionable);return {done:list.filter(x=>x.completed).length,total:list.length,missed:list.filter(x=>!x.completed).map(x=>x.text)};};
  state.checkHistory=[...(state.checkHistory||[]),{id:uid(),at,early:summary("early"),late:summary("late")}].slice(-400);
}
function checkHistoryView(){
  const history=[...(state.checkHistory||[])].reverse().slice(0,10);
  const cell=c=>`<span class="${c.done<c.total?"history-short":""}">${c.done}/${c.total}</span>`;
  const missed=h=>[...h.early.missed.map(text=>`早番: ${text}`),...h.late.missed.map(text=>`遅番: ${text}`)];
  return `<section class="card check-history"><div class="card-header"><h2>日次更新ごとの実施記録</h2><span class="meta">直近 ${history.length} 回</span></div><div class="card-body">${history.length?`<ul class="list-clean">${history.map(h=>{const left=missed(h);return `<li class="history-row"><span class="history-date">${esc(formatDate(h.at,{year:"numeric",month:"numeric",day:"numeric",weekday:"short",hour:"2-digit",minute:"2-digit"}))}</span><span>早番 ${cell(h.early)}</span><span>遅番 ${cell(h.late)}</span>${left.length?`<details><summary>未完了 ${left.length} 件</summary><ul>${left.map(text=>`<li>${esc(text)}</li>`).join("")}</ul></details>`:`<span class="meta">すべて完了</span>`}</li>`;}).join("")}</ul>`:noItems("日次更新を実行すると、その時点の完了数と未完了の項目がここに残ります")}</div></section>`;
}
// Links from Excel must pass the same check as links added in the app. A relative document link
// that the app does not already know is resolved against the chosen workbook's folder instead.
function joinWindowsPath(folder,relative){
  let rel=relative;try{rel=decodeURIComponent(relative);}catch{}
  const out=[];
  for(const part of [...String(folder).split(/[\\/]+/),...rel.split(/[\\/]+/)]){if(!part||part===".")continue;if(part===".."){if(out.length>1)out.pop();continue;}out.push(part);}
  return out.join("\\");
}
async function resolveExcelLinks(snapshot,folder){
  const urls=new Set([...snapshot.referenceLinks.map(link=>link.url),...Object.values(snapshot.shiftSections).flat().map(item=>item.url)].filter(Boolean));
  const known=new Set((state.referenceLinks||[]).map(link=>link.url));
  const resolved=new Map();
  for(const url of urls){
    if(known.has(url)){resolved.set(url,url);continue;}
    try{await api("/api/validate-reference-target","POST",{url});resolved.set(url,url);continue;}catch{}
    let absolute=null;
    if(folder&&!/^[A-Za-z][A-Za-z\d+.-]*:|^[\\/]/.test(url)){
      const candidate=joinWindowsPath(folder,url);
      try{await api("/api/validate-reference-target","POST",{url:candidate});absolute=candidate;}catch{}
    }
    resolved.set(url,absolute);
  }
  return resolved;
}
// Excel hyperlinks are relative to the workbook, so its folder becomes the base when it finds more documents.
async function adoptExcelFolderAsLinkBase(next,summary,folder){
  if(window.__todoBrowserMode||!folder)return;
  try{
    const links=(next.referenceLinks||[]).map(l=>({label:l.label,url:l.url}));
    const current=await api("/api/link-status","POST",{base:next.settings.linkBaseDir||"",links});
    if(!current.total||current.ok===current.total)return;
    const candidate=await api("/api/link-status","POST",{base:folder,links});
    if(candidate.ok>current.ok){next.settings.linkBaseDir=folder;summary.linkBase={folder,ok:candidate.ok,total:candidate.total};}
  }catch{}
}
async function importExcel(){
  try{
    const file=await api("/api/choose-excel-file","POST",{});
    if(!file?.ok)return;
    flash("Excelを読み込んでいます…");
    const bytes=file.bytes?new Uint8Array(file.bytes):Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0));
    let sha256=file.sha256||"";
    if(!sha256){try{sha256=await excelSha256(bytes);}catch{}}
    const snapshot=await excelBuildSnapshot(await excelReadWorkbook(bytes),{fileName:file.name,path:file.path||"",sha256,modifiedAt:file.modifiedAt||null,extractedAt:localTimestamp()});
    const resolved=await resolveExcelLinks(snapshot,file.folder||"");
    await saveChain;
    const {state:next,summary}=excelMergeIntoState(state,snapshot,resolved,localTimestamp());
    await adoptExcelFolderAsLinkBase(next,summary,file.folder||"");
    openExcelImportDialog(file,snapshot,next,summary);
  }catch(error){flash(`Excelを取り込めませんでした: ${error.message}`);}
}
function openExcelImportDialog(file,snapshot,next,summary){
  const shiftCount=name=>{const list=snapshot.shiftSections[name].filter(actionable);return `${list.filter(x=>x.completed).length}/${list.length}`;};
  const rows=[
    ["日次チェック",`早番 ${shiftCount("early")}・遅番 ${shiftCount("late")}（全 ${summary.checklist} 行、項目の変更 ${summary.checklistChanged} 行）`],
    ["自由 TODO",`${summary.todos} 件に置き換え`],
    ["リーダー記録",summary.recordsAdded?`${summary.recordsAdded} 件を追加（既存 ${(state.records||[]).length} 件はそのまま）`:`追加なし（既存 ${(state.records||[]).length} 件はそのまま）`],
    ["カレンダーの予定",`Excel の予定 ${summary.calendarEntries} 件`],
    ["関連リンク",`追加 ${summary.linksAdded} 件・参照先の更新 ${summary.linksUpdated} 件`],
    ...(summary.linkBase?[["文書リンクの基準フォルダー",`${summary.linkBase.folder} に設定（文書リンク ${summary.linkBase.total} 件中 ${summary.linkBase.ok} 件が開けます）`]]:[]),
    ["担当者の候補",summary.ownersAdded.length?`${summary.ownersAdded.join("、")} を追加`:"変更なし"],
    ["HP 画像チェック",summary.hpUpdated?`${summary.hpUpdated} 店舗を Excel の新しい結果に更新`:"変更なし（アプリ側の方が新しいか同じ）"]
  ];
  const warnings=[
    summary.todosArchived.length?`Excel に無い未完了の TODO ${summary.todosArchived.length} 件は「保管済み」へ移します（自由 TODO の「保管済み」から戻せます）。<ul>${summary.todosArchived.map(text=>`<li>${esc(text)}</li>`).join("")}</ul>`:"",
    summary.linksSkipped.length?`次の ${summary.linksSkipped.length} 件のリンクは、このアプリで開けない形式のため取り込みません。<ul>${summary.linksSkipped.map(url=>`<li>${esc(url)}</li>`).join("")}</ul>`:""
  ].filter(Boolean);
  openDialog(`<h2>Excel から取り込む</h2><p class="note">${esc(file.name)}${file.modifiedAt?`（更新 ${esc(formatDate(file.modifiedAt,{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}))}）`:""}</p><ul class="excel-import-summary">${rows.map(([label,value])=>`<li><strong>${esc(label)}</strong><span>${esc(value)}</span></li>`).join("")}</ul>${warnings.map(text=>`<div class="excel-import-warning">${text}</div>`).join("")}<p class="note">取り込む前の状態は自動でバックアップします。テーマ・既定担当・リンクの部門分けなど、アプリ側の設定は変わりません。</p><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">取り込む</button></div>`,async()=>{
    try{await api("/api/backup","POST",{reason:"before-excel-import"});}
    catch(error){flash(`取込み前のバックアップができなかったため中止しました: ${error.message}`);return false;}
    const previous=state;
    state=next;ensureSettingsState();ensureCalendarIds();applyTheme();render();
    if(!await save()){state=previous;applyTheme();render();flash("保存できなかったため、取込みを取り消しました");return true;}
    flash("Excel の内容を取り込みました");
    return true;
  });
}
async function exportData(){try{await saveChain;const result=window.__todoBrowserMode?await window.pywebview.api.export_data(state):await window.pywebview.api.export_data(currentUser());if(result.ok){mutate(()=>{state.settings.shareLog=[...(state.settings.shareLog||[]),{at:localTimestamp(),kind:"export",by:currentUser()||""}].slice(-20);});flash(browserLastSaveError?"未保存の画面データをJSONにバックアップしました":"共有用のJSONを書き出しました。ほかのリーダーに渡してください");}}catch(error){flash(`書き出せませんでした: ${error.message}`);}}
// Describes both sides before a JSON import replaces the data, so a newer edition is not overwritten by accident.
function importComparison(incoming){
  const editionName=meta=>meta?.edition==="edge"?"Edge版":meta?.edition==="exe"?"EXE版":"保存元不明";
  const savedAt=meta=>meta?.savedAt?formatDate(meta.savedAt,{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"日時不明";
  const counts=data=>`TODO ${(data.todos||[]).length}件・記録 ${(data.records||[]).length}件`;
  const lines=[`読み込むファイル: ${editionName(incoming.meta)}・${savedAt(incoming.meta)}（${counts(incoming)}）`,`現在のデータ　　: ${editionName(state.meta)}・${savedAt(state.meta)}（${counts(state)}）`];
  const incomingRecords=new Set((incoming.records||[]).map(r=>r.id)),incomingTodos=new Set([...(incoming.todos||[]),...(incoming.todoArchive||[])].map(t=>t.id));
  const lostRecords=(state.records||[]).filter(r=>!incomingRecords.has(r.id)).length,lostTodos=(state.todos||[]).filter(t=>!incomingTodos.has(t.id)).length;
  if(state.meta?.savedAt&&incoming.meta?.savedAt&&state.meta.savedAt>incoming.meta.savedAt)lines.push("","⚠ 現在のデータの方が新しく保存されています。");
  if(lostRecords||lostTodos)lines.push(`⚠ 読み込むファイルには無い、現在の記録 ${lostRecords} 件・TODO ${lostTodos} 件が置き換えで消えます。`);
  lines.push("","置き換える前の状態は自動でバックアップします。続けますか？");
  return lines.join("\n");
}
async function importData(){try{const result=await window.pywebview.api.import_data();if(!result.ok)return;if(!confirm(importComparison(result.state)))return;await api("/api/backup","POST",{reason:"before-json-import"});const previous=state;state=result.state;state.settings??={};ensureSettingsState();ensureCalendarIds();applyTheme();render();if(!await save()){state=previous;applyTheme();render();throw new Error("保存できなかったため、読み込みを取り消しました");}flash("データを読み込みました");}catch(error){flash(`読み込めませんでした: ${error.message}`);}}

document.addEventListener("click",async event=>{
  const viewButton=event.target.closest("[data-view]");if(viewButton){setView(viewButton.dataset.view);return;}
  const button=event.target.closest("[data-action]");if(!button)return;
  const action=button.dataset.action,id=button.dataset.id;
  if(action==="select-growth-record"){
    const fromList=!!button.closest(".growth-record-browser");
    if(fromList)growthListOpen=true;
    growthSelectedId=safeId(id);
    render();
    [...document.querySelectorAll(fromList?'.growth-record-option[data-action="select-growth-record"]':'.dollbox[data-action="select-growth-record"]')].find(item=>item.dataset.id===growthSelectedId)?.focus({preventScroll:true});
    return;
  }
  if(action==="show-all-growth"){
    mutate(()=>state.settings.graph.author="全員");
    return;
  }
  if(action==="set-theme"){
    const theme=button.dataset.theme;
    if(!state||!themeNames[theme]||theme===uiTheme())return;
    await saveSettingsChange(()=>{state.settings.uiTheme=theme;},`${themeNames[theme]} テーマに切り替えました`);
    return;
  }
  if(action==="growth-person"){mutate(()=>state.settings.graph.author=button.dataset.person||"全員");return;}
  if(action==="merge-data"){await mergeData();return;}
  if(action==="toggle-motion-follow"){const follow=state.settings.motionFollowOs!==true;await saveSettingsChange(()=>{state.settings.motionFollowOs=follow;},follow?"演出をWindowsのアニメーション設定に合わせます":"演出を常に表示します");return;}
  if(action==="enable-portable"||action==="disable-portable"){await switchStorage(action==="enable-portable");return;}
  if(action==="toggle-garo-sound"){if(typeof garoToggleSound==="function")await garoToggleSound();return;}
  if(action==="rename-owner"){renameOwner(button.dataset.owner);return;}
  if(action==="delete-owner"){await deleteOwner(button.dataset.owner);return;}
  if(action==="shift"){shift=button.dataset.value;render();}
  if(action==="reset-checks"){if(confirm("早番・遅番のチェックをすべて外しますか？"))mutate(()=>{for(const group of Object.values(state.shiftSections))for(const item of group)if(actionable(item))item.completed=false;},"チェックをリセットしました");}
  if(action==="toggle-check"){const item=byId(state.shiftSections[button.dataset.shift],id);if(item){mutate(()=>item.completed=button.checked);if(item.completed)garoEvent("check",{shift:button.dataset.shift,item});}}
  if(action==="toggle-todo"){const item=byId(state.todos,id);if(item){let next=null;mutate(()=>{item.completed=button.checked;touch(item);if(item.completed){item.completedAt=localTimestamp();next=createNextRepeat(item);}else delete item.completedAt;});if(item.completed)garoEvent("todo",{todo:item});if(next)flash(`次回分「${next.text}」（${formatDate(next.dueDate)}）を追加しました`);}}
  if(action==="restore-todo"){const item=byId(state.todoArchive||[],id);if(item)mutate(()=>{state.todoArchive=state.todoArchive.filter(t=>t!==item);const {archivedAt,archivedReason,completedAt,...todo}=item;state.todos.push(touch({...todo,id:byId(state.todos,todo.id)?uid():todo.id,completed:false,checkValue:null}));},"TODO を未完了に戻しました");}
  if(action==="edit-todo")editTodo(id);
  if(action==="calendar-edit-todo"){if(dialog.open)dialog.close();editTodo(id);}
  if(action==="edit-calendar-entry"){if(dialog.open)dialog.close();editCalendarEntry(id);}
  if(action==="delete-todo"){const item=byId(state.todos,id);if(item&&confirm(`「${item.text}」を削除しますか？`))deleteWithUndo(()=>{state.todos=state.todos.filter(t=>t.id!==id);tombstone("todo",id);},"TODO を削除しました");}
  if(action==="delete-calendar-entry"){const entry=byId(state.settings?.calendarEntries||[],id);if(entry&&confirm(`${formatDate(entry.date)}の予定「${String(entry.text||"").split("\n")[0]}」を削除しますか？`)){if(dialog.open)dialog.close();deleteWithUndo(()=>{state.settings.calendarEntries=state.settings.calendarEntries.filter(e=>e!==entry);tombstone("calendar",entry.id);},"予定を削除しました");}}
  if(action==="undo-delete")undoDelete();
  if(action==="print-checklist")printChecklist();
  if(action==="show-shortcuts")showShortcutHelp();
  if(action==="month-prev"){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()-1,1);calendarSelectedDate=localKey(calendarMonth);render();}
  if(action==="month-next"){calendarMonth=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,1);calendarSelectedDate=localKey(calendarMonth);render();}
  if(action==="month-today"){calendarMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);calendarSelectedDate=today();render();}
  if(action==="select-day")selectCalendarDay(button.dataset.date,button);
  if(action==="add-on-day"){if(dialog.open)dialog.close();addOnDay(button.dataset.date);}
  if(action==="add-calendar-entry"){if(dialog.open)dialog.close();addCalendarEntry(button.dataset.date);}
  if(action==="daily-update")dailyUpdate();
  if(action==="edit-record")editRecord(id);
  if(action==="delete-record"){const record=byId(state.records||[],id);if(record&&confirm(`${formatDate(record.recordedAt)}・${record.author||"記載者不明"}の記録を削除しますか？\n「削除した記録」から戻せます。`))deleteWithUndo(()=>{state.records=state.records.filter(r=>r!==record);state.recordTrash=[...(state.recordTrash||[]),{...record,deletedAt:localTimestamp()}];},"記録を削除しました");}
  if(action==="restore-record"){const record=byId(state.recordTrash||[],id);if(record)mutate(()=>{state.recordTrash=state.recordTrash.filter(r=>r!==record);const {deletedAt,...restored}=record;state.records.push({...restored,id:byId(state.records,restored.id)?uid():restored.id,restoredAt:localTimestamp()});if(!state.recordTrash.length)recordShowTrash=false;},"記録を戻しました");}
  if(action==="toggle-record-trash"){recordShowTrash=!recordShowTrash;render();}
  if(action==="report-weekly")openReportDialog("weekly");
  if(action==="report-monthly")openReportDialog("monthly");
  if(action==="check-hp")await checkHp(id);
  if(action==="check-all-hp"){button.disabled=true;for(const item of state.hpStores||[])await checkHp(item.id);flash("全店舗の確認が終わりました");}
  if(action==="open-link"){try{await saveChain;await api("/api/open-link","POST",{url:button.dataset.url});}catch(error){flash(error.message);}}
  if(action==="add-reference")editReference();
  if(action==="edit-reference")editReference(id);
  if(action==="delete-reference"){
    const link=byId(state.referenceLinks,id);
    if(link&&confirm(`「${link.label}」を関連リンクから削除しますか？`))deleteWithUndo(()=>{state.referenceLinks=state.referenceLinks.filter(item=>safeId(item.id)!==safeId(id));tombstone("link",id);},"関連リンクを削除しました");
  }
  if(action==="rename-department")renameDepartment(button.dataset.department);
  if(action==="choose-link-file"){
    try{const result=await api("/api/choose-link-file","POST",{});if(result.ok)$("#reference-url").value=result.path;}
    catch(error){flash(`文書を選べませんでした: ${error.message}`);}
  }
  if(action==="choose-link-base-dir"){
    try{const result=await api("/api/choose-link-base-dir","POST",{});if(result.ok)mutate(()=>state.settings.linkBaseDir=result.path,"基準フォルダーを変更しました");}
    catch(error){flash(`フォルダーを選べませんでした: ${error.message}`);}
  }
  if(action==="export-data")exportData();
  if(action==="import-data")await importData();
  if(action==="import-excel")await importExcel();
  if(action==="close-dialog")dialog.close();
  if(action==="open-data-folder"){try{await api("/api/open-data-folder","POST",{});}catch(error){flash(error.message);}}
});
document.addEventListener("submit",event=>{
  if(event.target.id==="settings-add-owner"){event.preventDefault();const data=new FormData(event.target);void addOwner(data.get("owner"));return;}
  if(event.target.id==="todo-add"){event.preventDefault();const form=event.target,data=new FormData(form),text=String(data.get("text")||"").trim();if(!text)return;const repeat=repeatLabels[data.get("repeat")]?String(data.get("repeat")):null,due=String(data.get("due")||"")||null;if(repeat&&!due){flash("繰り返す TODO には期日を入れてください");return;}mutate(()=>{const todo={id:uid(),text,dueDate:due,owner:String(data.get("owner")||"").trim()||null,completed:false,...(repeat?{repeat}:{})};applyTodoExtras(todo,data);state.todos.push(touch(todo));},"TODO を追加しました");garoEvent("todo-add");}
  if(event.target.id==="record-add"){event.preventDefault();const data=new FormData(event.target),text=String(data.get("text")||"").trim();if(!text)return;const record={id:uid(),recordedAt:localTimestamp(),author:String(data.get("author")||"").trim(),text};mutate(()=>{state.records.push(record);},"記録を追加しました");garoEvent("record",{record});}
  if(event.target.id==="draft-form"){event.preventDefault();const data=new FormData(event.target),text=String(data.get("text")||"").trim(),author=String(data.get("author")||"").trim();mutate(()=>{state.settings.reflectionDrafts=text?[{id:uid(),text,author}]:[];state.settings.handover={text,author};},"メモを保存しました");}
});
// Re-rendering replaces the search box, so wait until Japanese IME conversion is committed.
const searchInputs={"todo-search":value=>todoSearch=value,"record-search":value=>recordSearch=value,"reference-search":value=>referenceSearch=value,"growth-record-search":value=>{growthListOpen=true;growthRecordSearch=value;}};
function applySearchInput(target){const assign=searchInputs[target.id];if(!assign)return;assign(target.value);const pos=target.selectionStart;render();const next=document.getElementById(target.id);next?.focus();next?.setSelectionRange(pos,pos);}
document.addEventListener("input",event=>{if(!event.isComposing)applySearchInput(event.target);});
document.addEventListener("compositionend",event=>applySearchInput(event.target));
document.addEventListener("dblclick",event=>{
  if(currentView!=="calendar"||dialog.open)return;
  clearTimeout(calendarSideTimer);
  const item=event.target.closest("[data-calendar-todo-id],.day-chip[data-todo-id]");
  if(item){event.preventDefault();editTodo(item.dataset.calendarTodoId||item.dataset.todoId);return;}
  const entry=event.target.closest("[data-calendar-entry-id],.day-chip[data-entry-id]");
  if(entry){event.preventDefault();editCalendarEntry(entry.dataset.calendarEntryId||entry.dataset.entryId);return;}
  const day=event.target.closest('.day[data-action="select-day"]');
  if(day){event.preventDefault();selectCalendarDay(day.dataset.date,day,true);openCalendarDayEditor(day.dataset.date);}
});
document.addEventListener("click",event=>{const summary=event.target.closest(".growth-record-browser summary");if(summary)growthListOpen=!summary.parentElement.open;},true);
document.addEventListener("change",event=>{
  if(event.target.id==="settings-me"){
    const name=event.target.value;if(name&&!ownerChoices().includes(name)){flash("担当者の候補から選んでください");render();return;}
    void saveSettingsChange(()=>{state.settings.me=name;},name?`このPCの使用者を「${name}」にしました`:"このPCの使用者を未設定にしました");return;
  }
  if(event.target.id==="settings-default-owner"){
    const name=event.target.value;if(name&&!ownerChoices().includes(name)){flash("担当者の候補を選んでください");render();return;}
    void saveSettingsChange(()=>{state.settings.defaultTodoOwner=name;},"新しいTODOの既定担当を保存しました");return;
  }
  if(event.target.id==="settings-start-view"){
    const view=event.target.value;if(!startViewChoices.includes(view)){flash("起動時の画面を選んでください");render();return;}
    void saveSettingsChange(()=>{state.settings.startView=view;},"起動時に開く画面を保存しました");return;
  }
  if(event.target.id==="todo-filter"){todoFilter=event.target.value;render();}
  if(event.target.id==="todo-category-filter"){todoCategory=event.target.value;render();}
  if(event.target.id==="reference-department"){referenceDepartment=event.target.value;render();}
  if(event.target.id==="reference-kind"){
    const isFile=event.target.value==="file",input=$("#reference-url");
    input.value="";input.readOnly=isFile;
    input.placeholder=isFile?"ファイルを選んでください":"https://example.com";
    $("#reference-url-label").textContent=isFile?"文書の場所":"URL";
    $("#reference-file-button").classList.toggle("hidden",!isFile);
  }
  if(event.target.id==="growth-author"){mutate(()=>state.settings.graph.author=event.target.value);}
  if(event.target.id==="growth-period"){mutate(()=>state.settings.graph.period=event.target.value);}
  if(event.target.id==="growth-limit"){mutate(()=>state.settings.graph.limit=Number(event.target.value));}
});
$("#menu-button").addEventListener("click",()=>$(".sidebar").classList.toggle("open"));
window.addEventListener("hashchange",()=>{const view=location.hash.slice(1);if(labels[view]&&view!==currentView){currentView=view;render();}});

async function boot(){try{state=await api("/api/state");state.shiftSections??={early:[],late:[]};state.todos??=[];state.records??=[];state.referenceLinks??=[];state.settings??={};state.settings.graph??={};state.source??={};const migrated=[ensureSettingsState(),ensureCalendarIds()].some(Boolean);if(!location.hash.slice(1))currentView=startView();applyTheme();render();clockSignature=currentClockSignature();$("#save-status").textContent=window.__todoBrowserMode&&!window.__todoBrowserMode.hasData()?"初回・未読込":"自動保存済み";if(migrated)await save();}catch(error){main.innerHTML=`<section class="card card-body"><h1>読み込めませんでした</h1><p>${esc(error.message)}</p></section>`;$("#save-status").textContent="読み込みエラー";}}
window.addEventListener("pywebviewready",boot,{once:true});
// Keyboard: "/" search, "n" new item, Alt+1..8 screens, "?" help. Ignored while typing or in a dialog.
const shortcutViews=["home","checklist","todos","calendar","records","growth","hp","references"];
const shortcutList=[["/","この画面の検索欄へ移動"],["N","この画面で新しく追加（TODO・記録・予定・リンク・チェック項目）"],["Alt + 1〜8","ホーム／日次チェック／自由TODO／カレンダー／リーダー記録／成長／HP／関連リンクへ移動"],["Ctrl + Enter","入力欄の内容を保存（追加フォーム・編集画面）"],["?","このショートカット一覧を表示"]];
function showShortcutHelp(){openDialog(`<h2>キーボード操作</h2><table class="shortcut-table">${shortcutList.map(([key,text])=>`<tr><th><kbd>${esc(key)}</kbd></th><td>${esc(text)}</td></tr>`).join("")}</table><p class="note">文字を入力している間や、画面上のウィンドウを開いている間は、/ や N などは入力文字として扱います。</p><div class="dialog-actions"><button class="primary" type="button" data-action="close-dialog">閉じる</button></div>`,()=>true);}
function focusSearch(){
  if(currentView==="growth"){growthListOpen=true;render();}
  const box=document.querySelector("#todo-search,#record-search,#reference-search,#growth-record-search");
  if(box){box.focus();box.select();return true;}
  return false;
}
function startNewItem(){
  if(currentView==="todos"){$("#todo-text")?.focus();return true;}
  if(currentView==="records"){$("#record-text")?.focus();return true;}
  if(currentView==="calendar"){addOnDay(calendarSelectedDate||today());return true;}
  if(currentView==="references"){editReference();return true;}
  if(currentView==="checklist"&&typeof openChecklistItemDialog==="function"){if(!checklistEditing){checklistEditing=true;render();}openChecklistItemDialog(null,"");return true;}
  return false;
}
document.addEventListener("keydown",event=>{
  if(!state)return;
  const target=event.target,typing=/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)||target.isContentEditable;
  if(event.ctrlKey&&event.key==="Enter"&&typing&&target.form){event.preventDefault();target.form.requestSubmit();return;}
  if(typing||dialog.open||$("#report-dialog")?.open||event.isComposing)return;
  if(event.altKey&&!event.ctrlKey&&/^[1-8]$/.test(event.key)){event.preventDefault();setView(shortcutViews[Number(event.key)-1]);return;}
  if(event.ctrlKey||event.altKey||event.metaKey)return;
  if(event.key==="/"&&focusSearch()){event.preventDefault();return;}
  if((event.key==="n"||event.key==="N")&&startNewItem()){event.preventDefault();return;}
  if(event.key==="?"){event.preventDefault();showShortcutHelp();}
});

// Prints a blank early/late check sheet for paper use; the app screen itself is hidden while printing.
function printChecklist(){
  const sheet=name=>{
    const rows=(state.shiftSections?.[name]||[]).map(item=>{
      if(item.kind==="H")return `<tr class="print-heading"><th colspan="3">${esc(item.text)}${item.note?`<small>${esc(item.note)}</small>`:""}</th></tr>`;
      const box=actionable(item)?"☐":"";
      return `<tr><td class="print-box">${box}</td><td>${esc(item.text)}${item.note?`<small>${esc(item.note)}</small>`:""}</td><td class="print-time">${item.time?esc(String(item.time).slice(0,5)):""}</td></tr>`;
    }).join("");
    return `<section><h2>${name==="early"?"早番":"遅番"}</h2><table>${rows}</table></section>`;
  };
  document.getElementById("print-sheet")?.remove();
  const container=document.createElement("div");
  container.id="print-sheet";
  container.innerHTML=`<header><h1>日次チェック表</h1><span>日付　　　年　　月　　日（　）　　担当：＿＿＿＿＿＿</span></header><div class="print-columns">${sheet("early")}${sheet("late")}</div>`;
  document.body.append(container);
  document.body.classList.add("printing-checklist");
  const finish=()=>{document.body.classList.remove("printing-checklist");container.remove();};
  window.addEventListener("afterprint",finish,{once:true});
  window.print();
}
// Keeps "today", due badges and late checks current when the app stays open, without disturbing input.
let clockSignature="";
const currentClockSignature=()=>`${today()}|${[...lateChecks("early"),...lateChecks("late")].map(item=>item.id).join(",")}`;
// A redraw would reset any field the user has started filling in, even after focus moved away.
function hasUnsavedInput(){
  return [...main.querySelectorAll("input,textarea,select")].some(field=>{
    if(field.type==="checkbox"||field.type==="radio")return false;
    if(field.tagName==="SELECT")return [...field.options].some(option=>option.selected!==option.defaultSelected);
    return field.value!==field.defaultValue;
  });
}
setInterval(()=>{
  if(!state)return;
  const signature=currentClockSignature();
  if(signature===clockSignature)return;
  const busy=dialog.open||$("#report-dialog")?.open||/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||"")&&document.activeElement.type!=="checkbox"||hasUnsavedInput();
  if(busy)return;
  clockSignature=signature;
  if(["home","checklist","todos","calendar"].includes(currentView)){const y=window.scrollY;render();window.scrollTo(0,y);}
  else $("#today-label").textContent=formatDate(today(),{year:"numeric",month:"long",day:"numeric",weekday:"long"});
},30000);

function editReference(id=null){
  const link=id?byId(state.referenceLinks,id):null;
  if(id&&!link)return;
  const kind=link&&!webLink(link.url)?"file":"web";
  const departments=[...new Set((state.referenceLinks||[]).map(departmentOf))].sort((a,b)=>a.localeCompare(b,"ja"));
  openDialog(`<h2>${link?"関連リンクを編集":"関連リンクを追加"}</h2><div class="dialog-fields"><div class="field"><label for="reference-label">名前</label><input id="reference-label" name="label" required maxlength="120" value="${esc(link?.label||"")}" placeholder="例: 営業計画"></div><div class="field"><label for="reference-new-department">部門名</label><input id="reference-new-department" name="department" required maxlength="60" list="reference-departments" value="${esc(link?departmentOf(link):referenceDepartment||"")}" placeholder="既存の部門を選ぶか新しく入力"><datalist id="reference-departments">${departments.map(name=>`<option value="${esc(name)}"></option>`).join("")}</datalist></div><div class="field"><label for="reference-kind">種類</label><select id="reference-kind" name="kind"><option value="web" ${kind==="web"?"selected":""}>Webページ</option><option value="file" ${kind==="file"?"selected":""}>ローカル文書</option></select></div><div class="field"><label for="reference-url" id="reference-url-label">${kind==="web"?"URL":"文書の場所"}</label><input id="reference-url" name="url" required maxlength="2048" value="${esc(link?.url||"")}" ${kind==="file"?"readonly":""} placeholder="${kind==="web"?"https://example.com":"ファイルを選んでください"}"><button class="secondary ${kind==="web"?"hidden":""}" type="button" id="reference-file-button" data-action="choose-link-file">文書ファイルを選ぶ</button></div><p class="note">Webリンクは既定のブラウザで開きます。文書はこのPC上のExcel・PDF・Wordなどを選択してください。</p></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">${link?"変更を保存":"追加する"}</button></div>`,async data=>{
    const label=String(data.get("label")||"").trim(),department=String(data.get("department")||"").trim(),url=String(data.get("url")||"").trim(),selectedKind=String(data.get("kind")||"");
    if(!label||!department||!url){flash("名前、部門名、参照先を入力してください");return false;}
    if(selectedKind==="web"&&!/^https?:\/\/[^\s/]+/i.test(url)){flash("http または https のURLを入力してください");return false;}
    if(selectedKind==="file"&&webLink(url)){flash("文書ファイルを選んでください");return false;}
    try{const result=await api("/api/validate-reference-target","POST",{url});if((selectedKind==="web")!==(result.kind==="web")){flash("種類と参照先を確認してください");return false;}}
    catch(error){flash(`リンクを登録できません: ${error.message}`);return false;}
    referenceDepartment=department;
    mutate(()=>{if(link)touch(Object.assign(link,{label,department,url}));else state.referenceLinks.push(touch({id:uid(),group:"custom",label,department,url}));},link?"関連リンクを更新しました":"関連リンクを追加しました");
  });
}
function renameDepartment(name){
  const count=state.referenceLinks.filter(link=>departmentOf(link)===name).length;
  openDialog(`<h2>部門名を変更</h2><p class="note">「${esc(name)}」の ${count} 件をまとめて移します。</p><div class="field"><label for="renamed-department">新しい部門名</label><input id="renamed-department" name="department" required maxlength="60" value="${esc(name)}"></div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">変更する</button></div>`,data=>{
    const next=String(data.get("department")||"").trim();
    if(!next){flash("部門名を入力してください");return false;}
    if(next===name)return;
    if(!confirm(`「${name}」の ${count} 件を「${next}」へ移しますか？`))return false;
    referenceDepartment=next;
    mutate(()=>{for(const link of state.referenceLinks)if(departmentOf(link)===name)link.department=next;},"部門名を変更しました");
  });
}

