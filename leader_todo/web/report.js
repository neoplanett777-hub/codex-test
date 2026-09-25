"use strict";

// Both the desktop and the single-file Edge edition use this report definition and PDF renderer.
const REPORT_ALL_AUTHORS = "__all__";
const REPORT_NO_AUTHOR = "記載者未入力";
const REPORT_PAGE = [595.28, 841.89];
let reportFontCache = null;
let reportFontPromise = null;

function reportDateParts(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return { year, month, day, date };
}

function reportDateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function reportAddDays(key, days) {
  const parts = reportDateParts(key);
  if (!parts) return null;
  return reportDateKey(new Date(parts.date.getTime() + days * 86400000));
}

function reportJstParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}:${values.second}` };
}

function reportPeriod(kind, anchor) {
  if (kind === "weekly") {
    const parts = reportDateParts(anchor);
    if (!parts) return null;
    const mondayOffset = (parts.date.getUTCDay() + 6) % 7;
    const start = reportAddDays(anchor, -mondayOffset);
    return { start, end: reportAddDays(start, 6) };
  }
  if (kind === "monthly" && /^\d{4}-\d{2}$/.test(String(anchor || ""))) {
    const start = `${anchor}-01`;
    const parts = reportDateParts(start);
    if (!parts) return null;
    return { start, end: reportDateKey(new Date(Date.UTC(parts.year, parts.month, 0))) };
  }
  return null;
}

// A timestamp without a zone is the app's stored Japan wall time. Zoned timestamps
// are converted to Japan time before selecting a period.
function reportRecordedAt(value) {
  const raw = String(value ?? "");
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(raw);
  if (!match || !reportDateParts(match[1])) return null;
  const hour = Number(match[2]), minute = Number(match[3]), second = Number(match[4] || "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[5]) {
    const parsed = new Date(raw.replace(" ", "T"));
    if (Number.isNaN(parsed.getTime())) return null;
    const japan = reportJstParts(parsed);
    return { day: japan.date, time: japan.time, sort: `${japan.date}T${japan.time}` };
  }
  const time = `${match[2]}:${match[3]}:${String(second).padStart(2, "0")}`;
  return { day: match[1], time, sort: `${match[1]}T${time}` };
}

function reportAuthors(records) {
  return [...new Set((Array.isArray(records) ? records : []).map(record =>
    typeof record?.author === "string" && record.author.trim() ? record.author : ""
  ))].sort((a, b) => a.localeCompare(b, "ja"));
}

function reportBuildModel(kind, anchor, author, summary, sourceRecords, now = new Date()) {
  const period = reportPeriod(kind, anchor);
  if (!period) throw new Error("対象の日付または月を確認してください");
  const issues = [];
  const selected = [];
  (Array.isArray(sourceRecords) ? sourceRecords : []).forEach((record, index) => {
    const timestamp = reportRecordedAt(record?.recordedAt);
    if (!timestamp) {
      issues.push(`元データの ${index + 1} 件目は日時が無効なため除外しました。`);
      return;
    }
    if (timestamp.day < period.start || timestamp.day > period.end) return;
    const recordAuthor = typeof record?.author === "string" && record.author.trim() ? record.author : "";
    if (author !== REPORT_ALL_AUTHORS && recordAuthor !== author) return;
    const text = typeof record?.text === "string" ? record.text : "";
    if (!recordAuthor) issues.push(`${timestamp.day} ${timestamp.time} の記載者が空です。`);
    if (!text) issues.push(`${timestamp.day} ${timestamp.time} の本文が空です。`);
    selected.push({ day: timestamp.day, time: timestamp.time, sort: timestamp.sort,
      author: recordAuthor, text, index });
  });
  selected.sort((a, b) => a.sort.localeCompare(b.sort) || a.index - b.index);
  const groups = [];
  for (const record of selected) {
    let key, label;
    if (kind === "weekly") {
      key = record.day;
      label = `${record.day}`;
    } else {
      const day = reportDateParts(record.day).date;
      const monday = reportAddDays(record.day, -((day.getUTCDay() + 6) % 7));
      const sunday = reportAddDays(monday, 6);
      key = monday;
      label = `${monday < period.start ? period.start : monday} ～ ${sunday > period.end ? period.end : sunday}`;
    }
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label, records: [] };
      groups.push(group);
    }
    group.records.push(record);
  }
  const created = reportJstParts(now);
  return { kind, period, author, summary: String(summary ?? ""), records: selected, groups, issues,
    createdAt: `${created.date} ${created.time} JST`,
    filename: kind === "weekly"
      ? `リーダー記録_週次_${period.start}_${period.end}.pdf`
      : `リーダー記録_月次_${period.start.slice(0, 7)}.pdf` };
}

function reportAuthorLabel(author) {
  return author === REPORT_ALL_AUTHORS ? "全員" : author || REPORT_NO_AUTHOR;
}

function reportPreviewHtml(model) {
  const heading = model.kind === "weekly" ? "週次レポート" : "月次レポート";
  const groups = model.groups.map(group => `<section class="report-preview-group"><h4>${esc(group.label)} <span>${group.records.length} 件</span></h4>${group.records.map(record =>
    `<article class="report-preview-record"><div class="report-record-meta">${esc(`${record.day} ${record.time}`)} · ${esc(reportAuthorLabel(record.author))}</div><div class="report-record-body">${esc(record.text || "（本文なし）")}</div></article>`
  ).join("")}</section>`).join("");
  return `<div class="report-preview-paper"><h3>リーダー記録 ${heading}</h3><dl class="report-preview-meta"><div><dt>対象期間</dt><dd>${esc(model.period.start)} ～ ${esc(model.period.end)}</dd></div><div><dt>作成日時</dt><dd>${esc(model.createdAt)}</dd></div><div><dt>記録件数</dt><dd>${model.records.length} 件</dd></div><div><dt>対象記載者</dt><dd>${esc(reportAuthorLabel(model.author))}</dd></div></dl>${groups || '<div class="report-preview-empty">記録なし（0 件）</div>'}<section class="report-preview-summary"><h4>総括／次週・来月への引継ぎ</h4><div>${esc(model.summary || "（入力なし）")}</div></section></div>`;
}

function openReportDialog(kind) {
  if (kind !== "weekly" && kind !== "monthly") return;
  const dialog = document.querySelector("#report-dialog");
  const content = document.querySelector("#report-dialog-content");
  const sourceRecords = Array.isArray(state?.records) ? state.records.slice() : [];
  const todayJst = reportJstParts().date;
  const choices = reportAuthors(sourceRecords);
  content.innerHTML = `<div class="report-dialog-head"><div><div class="eyebrow">RECORD REPORT</div><h2>リーダー記録 ${kind === "weekly" ? "週次" : "月次"}レポート</h2><p>期間と記載者を選び、内容を確認して PDF に保存します。</p></div><button type="button" class="report-close" aria-label="閉じる">×</button></div>
    <div class="report-controls"><label class="field">${kind === "weekly" ? "基準日" : "対象月"}<input id="report-anchor" type="${kind === "weekly" ? "date" : "month"}" value="${kind === "weekly" ? todayJst : todayJst.slice(0, 7)}"></label>
    <label class="field">記載者<select id="report-author"><option value="${REPORT_ALL_AUTHORS}">全員</option>${choices.map(name => `<option value="${esc(name)}">${esc(name || REPORT_NO_AUTHOR)}</option>`).join("")}</select></label></div>
    <div id="report-period" class="report-period"></div>
    <label class="report-summary-label" for="report-summary">総括／次週・来月への引継ぎ <span>任意・出力専用</span></label>
    <textarea id="report-summary" rows="4" placeholder="今回の総括や、次回へ伝えたいことを入力"></textarea>
    <div id="report-issues" class="report-issues" role="status"></div>
    <div class="report-preview-heading"><h3>保存前プレビュー</h3><span>PDF も同じ対象と掲載順で作成します</span></div>
    <div id="report-preview" class="report-preview"></div>
    <div class="report-dialog-actions"><div id="report-save-status" role="status" aria-live="polite"></div><button type="button" class="secondary report-cancel">閉じる</button><button type="button" class="primary report-save">PDFを保存</button></div>`;
  const anchor = content.querySelector("#report-anchor");
  const author = content.querySelector("#report-author");
  const summary = content.querySelector("#report-summary");
  const status = content.querySelector("#report-save-status");
  const saveButton = content.querySelector(".report-save");
  function update() {
    status.textContent = "";
    try {
      const model = reportBuildModel(kind, anchor.value, author.value, summary.value, sourceRecords);
      content.querySelector("#report-period").textContent = `対象期間：${model.period.start} ～ ${model.period.end}　｜　${model.records.length} 件`;
      content.querySelector("#report-issues").innerHTML = model.issues.length
        ? `<strong>確認事項：${model.issues.length} 件</strong><ul>${model.issues.map(issue => `<li>${esc(issue)}</li>`).join("")}</ul>` : "";
      content.querySelector("#report-preview").innerHTML = reportPreviewHtml(model);
      saveButton.disabled = false;
      return model;
    } catch (error) {
      content.querySelector("#report-period").textContent = error.message;
      content.querySelector("#report-preview").innerHTML = "";
      content.querySelector("#report-issues").innerHTML = "";
      saveButton.disabled = true;
      return null;
    }
  }
  [anchor, author, summary].forEach(element => element.addEventListener("input", update));
  content.querySelector(".report-close").onclick = () => dialog.close();
  content.querySelector(".report-cancel").onclick = () => dialog.close();
  saveButton.onclick = async () => {
    const model = update();
    if (!model) return;
    saveButton.disabled = true;
    status.textContent = "PDF を作成しています…";
    try {
      // Edge requires the picker during the click's user activation, before awaiting PDF generation.
      let fileHandle = null;
      if (window.__todoBrowserMode) {
        if (typeof window.showSaveFilePicker !== "function") throw new Error("この Edge 環境では保存先の選択を利用できません");
        try {
          fileHandle = await window.showSaveFilePicker({ suggestedName: model.filename,
            types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }] });
        } catch (error) {
          if (error?.name === "AbortError") { status.textContent = "保存を取り消しました。"; return; }
          throw error;
        }
      }
      const bytes = await reportCreatePdf(model);
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        try { await writable.write(new Blob([bytes], { type: "application/pdf" })); await writable.close(); }
        catch (error) { try { await writable.abort?.(); } catch (_) {} throw error; }
        status.textContent = `${fileHandle.name} を保存しました（${model.records.length} 件）。`;
      } else {
        const result = await api("/api/report-pdf", "POST", {
          filename: model.filename, base64: PDFLib.encodeToBase64(bytes), count: model.records.length });
        if (result?.cancelled) { status.textContent = "保存を取り消しました。"; return; }
        if (!result?.ok) throw new Error("保存が完了しませんでした");
        status.textContent = `${result.path || model.filename} を保存しました（${model.records.length} 件）。`;
      }
      flash(status.textContent);
    } catch (error) {
      status.textContent = `PDF を保存できませんでした：${error?.message || error}`;
    } finally {
      saveButton.disabled = false;
    }
  };
  update();
  dialog.showModal();
}

async function reportFontBytes() {
  if (reportFontCache) return reportFontCache;
  if (!reportFontPromise) reportFontPromise = (async () => {
    let encoded = document.querySelector("#report-font")?.textContent?.trim() || "";
    if (!encoded) {
      const bridge = window.pywebview?.api;
      if (!bridge?.get_report_font_chunk) throw new Error("日本語フォントを読み込めませんでした");
      const parts = [];
      for (let index = 0; index <= 64; index++) {
        const response = await bridge.get_report_font_chunk(index);
        if (!response?.data) throw new Error("日本語フォントの読み込みが途中で止まりました");
        parts.push(response.data);
        if (!response.more) break;
        if (index === 64) throw new Error("日本語フォントが大きすぎます");
      }
      encoded = parts.join("");
    }
    const binary = atob(encoded);
    reportFontCache = Uint8Array.from(binary, char => char.charCodeAt(0));
    return reportFontCache;
  })();
  try { return await reportFontPromise; }
  catch (error) { reportFontPromise = null; throw error; }
}

function reportWrapLine(line, font, size, width) {
  if (!line) return [""];
  const wrapped = [];
  let current = "";
  // Keep base characters together with variation selectors and combining marks.
  // Measuring an incomplete sequence before embedding it can change fontkit's
  // subset mapping and silently drop U+FE0F from selectable PDF text.
  const segments = new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(line);
  for (const { segment } of segments) {
    if (current && font.widthOfTextAtSize(current + segment, size) > width) {
      wrapped.push(current);
      current = segment;
    } else current += segment;
  }
  wrapped.push(current);
  return wrapped;
}

function reportCheckGlyphs(model, fontBytes) {
  const face = window.fontkit.create(fontBytes);
  const values = [model.period.start, model.period.end, model.createdAt,
    reportAuthorLabel(model.author), model.summary, ...model.issues];
  for (const group of model.groups) {
    values.push(group.label);
    for (const record of group.records) values.push(record.day, record.time, reportAuthorLabel(record.author), record.text);
  }
  const missing = new Set();
  for (const value of values) {
    for (const char of String(value)) {
      const codePoint = char.codePointAt(0);
      if (codePoint === 10 || codePoint === 13 || codePoint === 9) continue;
      // Variation selectors are preserved in the PDF ToUnicode text even though
      // this font has no independent outline for them (for example ⚠️).
      if ((codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||
          (codePoint >= 0xE0100 && codePoint <= 0xE01EF)) continue;
      if (!face.hasGlyphForCodePoint(codePoint)) missing.add(char);
    }
  }
  if (missing.size) {
    const examples = [...missing].slice(0, 8).map(char => `${char} (U+${char.codePointAt(0).toString(16).toUpperCase()})`);
    throw new Error(`日本語フォントで表示できない文字があります：${examples.join("、")}${missing.size > 8 ? " ほか" : ""}。元記録は変更していません。`);
  }
}

// The desktop window keeps the PDF libraries out of its first page (WebView2 caps the page size),
// so they are fetched from the host the first time a PDF is made. Their hashes are already in the CSP.
let reportLibrariesPromise = null;
async function reportLoadLibraries() {
  if (window.PDFLib && window.fontkit) return;
  if (!reportLibrariesPromise) reportLibrariesPromise = (async () => {
    const bridge = window.pywebview?.api;
    if (!bridge?.get_vendor_script_chunk) throw new Error("PDF 作成部品を読み込めませんでした");
    for (const name of ["pdf-lib", "fontkit"]) {
      const parts = [];
      for (let index = 0; index <= 16; index++) {
        const response = await bridge.get_vendor_script_chunk(name, index);
        if (typeof response?.data !== "string") throw new Error("PDF 作成部品の読み込みが途中で止まりました");
        parts.push(response.data);
        if (!response.more) break;
        if (index === 16) throw new Error("PDF 作成部品が大きすぎます");
      }
      const script = document.createElement("script");
      script.textContent = parts.join("");
      document.head.appendChild(script);
    }
    if (!window.PDFLib || !window.fontkit) throw new Error("PDF 作成部品を読み込めませんでした");
  })();
  try { await reportLibrariesPromise; }
  catch (error) { reportLibrariesPromise = null; throw error; }
}

async function reportCreatePdf(model) {
  await reportLoadLibraries();
  const pdf = await PDFLib.PDFDocument.create();
  pdf.registerFontkit(window.fontkit);
  const fontBytes = await reportFontBytes();
  reportCheckGlyphs(model, fontBytes);
  // fontkit's subset mapping is changed by repeated width measurements. A full
  // embed keeps long wrapped Japanese text visible on every page.
  const font = await pdf.embedFont(fontBytes, { subset: false });
  pdf.setTitle(`リーダー記録 ${model.kind === "weekly" ? "週次" : "月次"}レポート`);
  pdf.setCreator("リーダー TODO");
  const ink = PDFLib.rgb(0.15, 0.22, 0.24);
  const muted = PDFLib.rgb(0.40, 0.48, 0.49);
  const accent = PDFLib.rgb(0.06, 0.42, 0.39);
  let page, y;
  const left = 48, right = REPORT_PAGE[0] - 48, bottom = 58;
  function newPage() { page = pdf.addPage(REPORT_PAGE); y = REPORT_PAGE[1] - 52; }
  function reserve(height) { if (y - height < bottom) newPage(); }
  function drawText(value, size = 10.5, color = ink, indent = 0, leading = 17) {
    const width = right - left - indent;
    for (const rawLine of String(value).replace(/\r\n?/g, "\n").split("\n")) {
      for (const line of reportWrapLine(rawLine, font, size, width)) {
        reserve(leading);
        if (line) page.drawText(line, { x: left + indent, y, size, font, color });
        y -= leading;
      }
    }
  }
  function gap(points) { reserve(points); y -= points; }
  function divider() { reserve(10); page.drawLine({ start: { x: left, y }, end: { x: right, y },
    thickness: 0.6, color: PDFLib.rgb(0.83, 0.88, 0.87) }); y -= 10; }
  newPage();
  drawText(`リーダー記録 ${model.kind === "weekly" ? "週次" : "月次"}レポート`, 18, accent, 0, 28);
  drawText(`対象期間　${model.period.start} ～ ${model.period.end}`, 11, ink, 0, 20);
  drawText(`作成日時　${model.createdAt}`, 10, muted);
  drawText(`記録件数　${model.records.length} 件`, 10, muted);
  drawText(`対象記載者　${reportAuthorLabel(model.author)}`, 10, muted);
  gap(12); divider();
  if (!model.records.length) {
    gap(22); drawText("記録なし（0 件）", 14, muted, 0, 22);
  } else {
    for (const group of model.groups) {
      reserve(90); gap(13);
      drawText(`${group.label}　${group.records.length} 件`, 13, accent, 0, 22);
      for (const record of group.records) {
        reserve(50); gap(8);
        drawText(`${record.day} ${record.time}　${reportAuthorLabel(record.author)}`, 10, muted, 0, 18);
        drawText(record.text || "（本文なし）", 10.5, ink, 0, 17);
        divider();
      }
    }
  }
  gap(17);
  drawText("総括／次週・来月への引継ぎ", 12, accent, 0, 22);
  drawText(model.summary || "（入力なし）", 10.5, ink, 0, 17);
  if (model.issues.length) {
    gap(18);
    drawText(`元データの確認事項　${model.issues.length} 件`, 11, muted, 0, 20);
    for (const issue of model.issues) drawText(`・${issue}`, 9, muted, 0, 15);
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: left, y: 43 }, end: { x: right, y: 43 },
      thickness: 0.5, color: PDFLib.rgb(0.83, 0.88, 0.87) });
    item.drawText(`${index + 1} / ${pages.length}`, { x: right - 41, y: 27, size: 9, font, color: muted });
  });
  return pdf.save();
}
