"use strict";

// 3人のリーダーが各自のPCで入力したデータを、JSONのやり取りで1つに合わせる。
// 取り込みは「足し合わせ」で、同じ項目が両方にあるときは新しく変更された方を残す。
// 削除した項目は tombstones に残るので、他の人のデータから復活しない。

const shareRecordStamp = r => [r?.recordedAt, r?.editedAt, r?.restoredAt].map(v => String(v || "")).sort().at(-1);
const shareTodoStamp = t => String(t?.updatedAt || t?.completedAt || "");
const shareItemStamp = x => String(x?.updatedAt || x?.editedAt || "");

function shareDeadIds(tombstones, kind){
  return new Set((tombstones || []).filter(t => t && t.kind === kind).map(t => safeId(t.id)));
}

function shareMergeTombstones(a, b){
  const seen = new Map();
  for (const t of [...(a || []), ...(b || [])]) {
    if (!t || !t.kind || !t.id) continue;
    const key = `${t.kind}:${safeId(t.id)}`;
    if (!seen.has(key) || String(t.at || "") > String(seen.get(key).at || "")) seen.set(key, t);
  }
  return [...seen.values()].sort((x, y) => String(x.at || "").localeCompare(String(y.at || ""))).slice(-2000);
}

// Two lists whose items move between an "active" and a "put away" list (records ⇄ trash, todos ⇄ archive).
// For every id the newest version wins, and it lands in the list it came from.
function shareMergePaired(local, incoming, keys, stamps, dead){
  const [activeKey, storedKey] = keys;
  const candidates = new Map();
  const consider = (item, where, origin) => {
    if (!item || item.id == null) return;
    const id = safeId(item.id);
    const stamp = stamps[where](item);
    const current = candidates.get(id);
    // Ties keep the local copy so a re-import of the same file changes nothing.
    if (!current || stamp > current.stamp) candidates.set(id, {item, where, origin, stamp});
  };
  for (const item of local[activeKey] || []) consider(item, "active", "local");
  for (const item of local[storedKey] || []) consider(item, "stored", "local");
  for (const item of incoming[activeKey] || []) consider(item, "active", "incoming");
  for (const item of incoming[storedKey] || []) consider(item, "stored", "incoming");
  const localWhere = new Map([...(local[activeKey] || []).map(x => [safeId(x.id), "active"]), ...(local[storedKey] || []).map(x => [safeId(x.id), "stored"])]);
  const result = {active: [], stored: [], added: [], updated: 0, putAway: 0};
  for (const [id, pick] of candidates) {
    if (pick.where === "active" && dead.has(id)) continue;
    result[pick.where].push(JSON.parse(JSON.stringify(pick.item)));
    if (pick.origin !== "incoming") continue;
    const before = localWhere.get(id);
    if (!before) { if (pick.where === "active") result.added.push(pick.item); }
    else if (before !== pick.where && pick.where === "stored") result.putAway++;
    else result.updated++;
  }
  return result;
}

function shareMergeList(local, incoming, dead){
  const map = new Map();
  const localIds = new Set();
  for (const item of local || []) { if (item?.id == null) continue; map.set(safeId(item.id), item); localIds.add(safeId(item.id)); }
  let added = 0, updated = 0;
  for (const item of incoming || []) {
    if (item?.id == null) continue;
    const id = safeId(item.id);
    const current = map.get(id);
    if (!current) { map.set(id, item); added++; }
    else if (shareItemStamp(item) > shareItemStamp(current)) { map.set(id, item); updated++; }
  }
  const list = [...map.entries()].filter(([id]) => !dead.has(id)).map(([, item]) => JSON.parse(JSON.stringify(item)));
  const removed = [...localIds].filter(id => dead.has(id)).length;
  return {list, added, updated, removed};
}

function mergeStates(local, incoming){
  const next = JSON.parse(JSON.stringify(local));
  const tombstones = shareMergeTombstones(local.tombstones, incoming.tombstones);
  next.tombstones = tombstones;

  const records = shareMergePaired(local, incoming, ["records", "recordTrash"], {active: shareRecordStamp, stored: r => String(r?.deletedAt || "")}, new Set());
  next.records = records.active;
  next.recordTrash = records.stored;

  const todos = shareMergePaired(local, incoming, ["todos", "todoArchive"], {active: shareTodoStamp, stored: t => String(t?.archivedAt || "")}, shareDeadIds(tombstones, "todo"));
  next.todos = todos.active;
  next.todoArchive = todos.stored;

  next.settings ??= {};
  const calendar = shareMergeList(local.settings?.calendarEntries, incoming.settings?.calendarEntries, shareDeadIds(tombstones, "calendar"));
  next.settings.calendarEntries = calendar.list;

  const links = shareMergeList(local.referenceLinks, incoming.referenceLinks, shareDeadIds(tombstones, "link"));
  next.referenceLinks = links.list;

  const history = new Map((local.checkHistory || []).map(h => [safeId(h.id), h]));
  for (const h of incoming.checkHistory || []) if (h?.id != null && !history.has(safeId(h.id))) history.set(safeId(h.id), h);
  next.checkHistory = [...history.values()].sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))).slice(-400);

  const ownersAdded = [];
  next.owners = Array.isArray(next.owners) ? next.owners : [];
  for (const name of incoming.owners || []) if (typeof name === "string" && name.trim() && !next.owners.includes(name.trim())) { next.owners.push(name.trim()); ownersAdded.push(name.trim()); }

  let hpUpdated = 0;
  const incomingStores = new Map((incoming.hpStores || []).map(s => [safeId(s.id), s]));
  next.hpStores = (next.hpStores || []).map(store => {
    const other = incomingStores.get(safeId(store.id));
    if (other && String(other.checkedAt || "") > String(store.checkedAt || "")) { hpUpdated++; return JSON.parse(JSON.stringify(other)); }
    return store;
  });

  const byAuthor = {};
  for (const r of records.added) { const name = String(r.author || "記載者不明"); byAuthor[name] = (byAuthor[name] || 0) + 1; }
  const summary = {
    from: String(incoming.settings?.me || ""),
    savedAt: incoming.meta?.savedAt || "",
    recordsAdded: records.added.length, recordsByAuthor: byAuthor, recordsUpdated: records.updated, recordsTrashed: records.putAway,
    todosAdded: todos.added.length, todosUpdated: todos.updated, todosArchived: todos.putAway,
    calendarAdded: calendar.added, calendarUpdated: calendar.updated, calendarRemoved: calendar.removed,
    linksAdded: links.added, linksUpdated: links.updated, linksRemoved: links.removed,
    ownersAdded, hpUpdated
  };
  summary.changes = summary.recordsAdded + summary.recordsUpdated + summary.recordsTrashed + summary.todosAdded + summary.todosUpdated + summary.todosArchived +
    summary.calendarAdded + summary.calendarUpdated + summary.calendarRemoved + summary.linksAdded + summary.linksUpdated + summary.linksRemoved + ownersAdded.length + hpUpdated;
  next.settings.shareLog = [...(next.settings.shareLog || []), {at: localTimestamp(), kind: "import", from: summary.from, savedAt: summary.savedAt, records: summary.recordsAdded, todos: summary.todosAdded}].slice(-20);
  return {state: next, summary};
}

async function mergeData(){
  try{
    await saveChain;
    const result = await window.pywebview.api.import_data();
    if (!result?.ok) return;
    const {state: next, summary} = mergeStates(state, result.state);
    const who = summary.from ? `${summary.from} さんのデータ` : "受け取ったデータ";
    const saved = summary.savedAt ? formatDate(summary.savedAt, {year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"}) : "日時不明";
    const authors = Object.entries(summary.recordsByAuthor).map(([name, count]) => `${name} ${count}件`).join("・");
    const rows = [
      ["リーダー記録", `追加 ${summary.recordsAdded} 件${authors ? `（${authors}）` : ""}・更新 ${summary.recordsUpdated} 件・削除の反映 ${summary.recordsTrashed} 件`],
      ["自由 TODO", `追加 ${summary.todosAdded} 件・更新 ${summary.todosUpdated} 件・保管の反映 ${summary.todosArchived} 件`],
      ["カレンダーの予定", `追加 ${summary.calendarAdded} 件・更新 ${summary.calendarUpdated} 件・削除の反映 ${summary.calendarRemoved} 件`],
      ["関連リンク", `追加 ${summary.linksAdded} 件・更新 ${summary.linksUpdated} 件・削除の反映 ${summary.linksRemoved} 件`],
      ["担当者の候補", summary.ownersAdded.length ? `${summary.ownersAdded.join("、")} を追加` : "変更なし"],
      ["HP 画像チェック", summary.hpUpdated ? `${summary.hpUpdated} 店舗を新しい結果に更新` : "変更なし"]
    ];
    openDialog(`<h2>共有データを取り込む</h2><p class="note">${esc(who)}（保存 ${esc(saved)}）を、このPCのデータに足し合わせます。</p><ul class="excel-import-summary">${rows.map(([label, value]) => `<li><strong>${esc(label)}</strong><span>${esc(value)}</span></li>`).join("")}</ul>${summary.changes ? "" : `<div class="excel-import-warning">このPCのデータにはすでにすべて入っています。取り込んでも変わりません。</div>`}<p class="note">このPCの記録・TODOは消えません。同じ項目が両方で変更されていたときは、あとから変更した方を残します。日次チェックの状態・テーマ・このPCの使用者は変わりません。取り込む前の状態は自動でバックアップします。</p><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">取り込む</button></div>`, async () => {
      try { await api("/api/backup", "POST", {reason: "before-json-import"}); }
      catch (error) { flash(`取込み前のバックアップができなかったため中止しました: ${error.message}`); return false; }
      const previous = state;
      state = next; ensureSettingsState(); ensureCalendarIds(); applyTheme(); render();
      if (!await save()) { state = previous; applyTheme(); render(); flash("保存できなかったため、取込みを取り消しました"); return true; }
      flash(summary.changes ? `共有データを取り込みました（記録 +${summary.recordsAdded}・TODO +${summary.todosAdded}）` : "新しく取り込む内容はありませんでした");
      garoEvent("merge", {summary});
      return true;
    });
  }catch(error){ flash(`取り込めませんでした: ${error.message}`); }
}

function shareHistoryView(){
  const log = [...(state.settings?.shareLog || [])].reverse().slice(0, 5);
  if (!log.length) return "";
  const when = at => formatDate(at, {month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"});
  return `<div class="share-log"><strong>最近の共有</strong><ul class="list-clean">${log.map(entry => entry.kind === "export"
    ? `<li><span class="meta">${esc(when(entry.at))}</span> 共有用に書き出し${entry.by ? `（${esc(entry.by)}）` : ""}</li>`
    : `<li><span class="meta">${esc(when(entry.at))}</span> ${esc(entry.from || "受け取ったデータ")}から取り込み（記録 +${Number(entry.records) || 0}・TODO +${Number(entry.todos) || 0}）</li>`).join("")}</ul></div>`;
}

// ---------- Where the data is kept: this PC (AppData) or next to the exe (USB portable mode) ----------
let storageInfo = null;
async function loadStorageInfo(){
  try { storageInfo = await window.pywebview?.api?.get_storage_info?.() || null; } catch { storageInfo = null; }
  if (state && currentView === "settings") render();
}
window.addEventListener("pywebviewready", () => setTimeout(loadStorageInfo, 0), {once: true});

function storageView(){
  if (!storageInfo) return "";
  const portable = storageInfo.portable;
  return `<div class="storage-mode ${portable ? "portable" : ""}"><strong>${portable ? "USBで持ち歩くモード" : "このPCに保存するモード"}</strong><small>保存先：${esc(storageInfo.path)}</small><p class="note">${portable
    ? "記録・テーマ・演出の設定・登録した画像を exe と同じフォルダーの「LeaderTODO_data」に保存しています。exe とこのフォルダーをいっしょに移せば、別のPCでも同じ状態で使えます。"
    : "記録・テーマ・演出の設定・登録した画像はこのPCのユーザーフォルダーに保存しています。exe だけを別のPCへ移すと、そのPCでは最初の状態から始まります。"}</p><div class="settings-data-actions">${portable ? button("disable-portable", "このPCに保存するモードに戻す") : button("enable-portable", "USBで持ち歩けるモードにする", "primary")}</div></div>`;
}

async function switchStorage(toPortable){
  const message = toPortable
    ? `今のデータを exe と同じフォルダーの「LeaderTODO_data」にコピーし、これからはそこに保存します。\n\nexe を USB メモリなどに入れたフォルダーの中に置いてから実行してください。\n（コピー先: ${storageInfo?.portablePath || "exe と同じフォルダー"}）\n\n続けますか？`
    : `持ち歩き用のデータをこのPCにコピーし、これからはこのPCに保存します。\nこのPCにあった以前のデータはバックアップに残します。持ち歩き用フォルダーは名前を変えて残します。\n\n続けますか？`;
  if (!confirm(message)) return;
  try {
    await saveChain;
    const api = window.pywebview.api;
    storageInfo = toPortable ? await api.enable_portable() : await api.disable_portable();
    state = await api.get_state();
    ensureSettingsState(); applyTheme(); render();
    flash(toPortable ? "USBで持ち歩けるモードにしました" : "このPCに保存するモードに戻しました");
  } catch (error) { flash(`切り替えられませんでした: ${error.message}`); }
}
