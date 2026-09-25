"use strict";

// Editing the early/late checklist. Items keep the Excel kinds: T/S = check item, H = heading,
// N = note, I = information without a check box.
let checklistEditing = false;
const checklistKinds = {T: "チェック項目", H: "見出し", N: "メモ（チェックなし）", I: "情報（チェックなし）", S: "店舗HP確認（チェック項目）"};

function checklistEditorView(){
  const items = state.shiftSections?.[shift] || [];
  const row = (item, index) => `<li class="checklist-edit-row ${item.kind === "H" ? "is-heading" : ""}">
    <span class="checklist-edit-kind">${esc(checklistKinds[item.kind] || item.kind)}</span>
    <span class="checklist-edit-text"><strong>${esc(item.text)}</strong>${item.note ? `<small>${esc(item.note)}</small>` : ""}${item.time ? `<small>時刻 ${esc(String(item.time).slice(0, 5))}</small>` : ""}${item.url ? `<small>リンクあり</small>` : ""}</span>
    <span class="checklist-edit-actions">
      <button type="button" class="icon-button" data-action="checklist-move" data-id="${esc(item.id)}" data-dir="-1" ${index === 0 ? "disabled" : ""} aria-label="${esc(item.text)}を上へ">↑</button>
      <button type="button" class="icon-button" data-action="checklist-move" data-id="${esc(item.id)}" data-dir="1" ${index === items.length - 1 ? "disabled" : ""} aria-label="${esc(item.text)}を下へ">↓</button>
      <button type="button" class="icon-button" data-action="checklist-edit" data-id="${esc(item.id)}">編集</button>
      <button type="button" class="icon-button" data-action="checklist-add" data-after="${esc(item.id)}">下に追加</button>
      <button type="button" class="icon-button" data-action="checklist-delete" data-id="${esc(item.id)}">削除</button>
    </span></li>`;
  return `<section class="card"><div class="card-header"><h2>${shift === "early" ? "早番" : "遅番"}の項目を編集</h2><button type="button" class="soft-button" data-action="checklist-add" data-after="">先頭に追加</button></div><div class="card-body">
    <p class="note">並び順は ↑ ↓ で変えられます。見出しの下にある項目が、その見出しのグループになります。Excel から取り込むと、日次チェックの項目は Excel の内容に置き換わります。</p>
    ${items.length ? `<ol class="checklist-edit-list">${items.map(row).join("")}</ol>` : noItems("項目がありません。「先頭に追加」から作成してください")}</div></section>`;
}

function checklistLinkOptions(current){
  const links = (state.referenceLinks || []).filter(link => link.url);
  const known = links.some(link => link.url === current);
  return `<option value="" ${current ? "" : "selected"}>リンクなし</option>${current && !known ? `<option value="${esc(current)}" selected>（現在のリンク）${esc(current)}</option>` : ""}${links.map(link => `<option value="${esc(link.url)}" ${link.url === current ? "selected" : ""}>${esc(link.label || link.url)}${link.department ? `（${esc(link.department)}）` : ""}</option>`).join("")}`;
}

function openChecklistItemDialog(item, afterId){
  const kinds = Object.entries(checklistKinds).filter(([kind]) => kind !== "S" || item?.kind === "S");
  const kind = item?.kind || "T";
  openDialog(`<h2>${item ? "日次チェックの項目を編集" : `${shift === "early" ? "早番" : "遅番"}に項目を追加`}</h2><div class="dialog-fields">
    <div class="field"><label for="checklist-kind">種類</label><select id="checklist-kind" name="kind">${kinds.map(([value, label]) => `<option value="${value}" ${value === kind ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></div>
    <div class="field"><label for="checklist-text">内容</label><input id="checklist-text" name="text" required maxlength="120" value="${esc(item?.text || "")}"></div>
    <div class="field"><label for="checklist-note">補足</label><input id="checklist-note" name="note" maxlength="120" value="${esc(item?.note || "")}" placeholder="任意"></div>
    <div class="field"><label for="checklist-time">時刻</label><input id="checklist-time" name="time" type="time" value="${esc(String(item?.time || "").slice(0, 5))}"><small class="note">チェック項目だけに使います。時刻を過ぎても未チェックの場合に目立たせます。</small></div>
    <div class="field"><label for="checklist-url">リンク</label><select id="checklist-url" name="url">${checklistLinkOptions(item?.url || "")}</select><small class="note">関連リンクに登録したものから選べます。</small></div>
  </div><div class="dialog-actions"><button class="secondary" type="button" data-action="close-dialog">キャンセル</button><button class="primary" type="submit">${item ? "保存" : "追加"}</button></div>`, data => {
    const text = String(data.get("text") || "").trim();
    if (!text) { flash("内容を入力してください"); return false; }
    const nextKind = String(data.get("kind") || "T");
    if (!checklistKinds[nextKind]) return false;
    const checkable = nextKind === "T" || nextKind === "S";
    const time = checkable && data.get("time") ? `${String(data.get("time")).slice(0, 5)}:00` : null;
    const values = {kind: nextKind, text, note: String(data.get("note") || "").trim() || null, time, url: String(data.get("url") || "") || null};
    mutate(() => {
      const list = state.shiftSections[shift];
      if (item) {
        const target = byId(list, item.id);
        if (!target) return;
        Object.assign(target, values);
        if (!checkable) { target.completed = false; target.checkValue = null; }
        return;
      }
      const created = {id: `${shift}-app-${uid()}`, sourceRow: null, ...values, completed: false, checkValue: null};
      const index = afterId ? list.findIndex(entry => entry.id === afterId) + 1 : 0;
      list.splice(index, 0, created);
    }, item ? "項目を更新しました" : "項目を追加しました");
  });
}

function moveChecklistItem(id, direction){
  const list = state.shiftSections?.[shift] || [];
  const index = list.findIndex(item => item.id === id), target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return;
  mutate(() => { [list[index], list[target]] = [list[target], list[index]]; });
  document.querySelector(`[data-action="checklist-move"][data-id="${CSS.escape(id)}"][data-dir="${direction}"]`)?.focus();
}

function deleteChecklistItem(id){
  const list = state.shiftSections?.[shift] || [];
  const item = byId(list, id);
  if (!item) return;
  const extra = item.kind === "H" ? "\n見出しを削除すると、その下の項目は前の見出しのグループに含まれます。" : "";
  if (!confirm(`「${item.text}」を${shift === "early" ? "早番" : "遅番"}から削除しますか？${extra}`)) return;
  deleteWithUndo(() => { state.shiftSections[shift] = list.filter(entry => entry.id !== id); }, "項目を削除しました");
}

document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button || !state) return;
  const action = button.dataset.action;
  if (action === "toggle-checklist-edit") { checklistEditing = !checklistEditing; render(); }
  if (action === "checklist-move") moveChecklistItem(button.dataset.id, Number(button.dataset.dir));
  if (action === "checklist-edit") { const item = byId(state.shiftSections?.[shift] || [], button.dataset.id); if (item) openChecklistItemDialog(item); }
  if (action === "checklist-add") openChecklistItemDialog(null, button.dataset.after || "");
  if (action === "checklist-delete") deleteChecklistItem(button.dataset.id);
});
