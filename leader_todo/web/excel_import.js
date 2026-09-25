"use strict";

// Reads the original 最新TODO EX workbook (.xlsm/.xlsx) without Excel or network access.
// The layout mirrors the "TO DO" sheet of the original workbook (C2=早番, H2=遅番, L2=備考・TODO).
const EXCEL_MAIN_ROWS = [3, 53];
const EXCEL_WEEK_COLUMNS = ["Q", "R", "S", "T", "U", "V", "W"];
const EXCEL_MAX_BYTES = 20_000_000;

async function excelUnzip(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("Excelファイルとして読み取れません");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Excelファイルの構造が壊れています");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, {method, compressedSize, localOffset});
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const decoder = new TextDecoder("utf-8");
  return async function read(name) {
    const entry = entries.get(name);
    if (!entry) return null;
    const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
    const raw = data.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return decoder.decode(raw);
    if (entry.method !== 8) throw new Error("対応していない圧縮形式です");
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return decoder.decode(await new Response(stream).arrayBuffer());
  };
}

const excelEntities = {amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'"};
function excelText(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => {
    if (code[0] === "#") return String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return excelEntities[code] ?? match;
  }).replace(/_x([0-9A-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
function excelAttrs(tag) {
  const result = {};
  for (const [, key, value] of tag.matchAll(/([\w:]+)="([^"]*)"/g)) result[key] = excelText(value);
  return result;
}
// Rich text keeps only visible runs; phonetic guides (rPh) are not part of the cell text.
function excelInlineText(xml) {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map(match => excelText(match[1] || "")).join("");
}
function excelRelationships(xml) {
  const result = new Map();
  for (const [tag] of String(xml || "").matchAll(/<Relationship\b[^>]*>/g)) {
    const attrs = excelAttrs(tag);
    result.set(attrs.Id, attrs);
  }
  return result;
}
function excelDateStyles(xml) {
  const custom = new Map();
  for (const [tag] of String(xml || "").matchAll(/<numFmt\b[^>]*>/g)) {
    const attrs = excelAttrs(tag);
    custom.set(Number(attrs.numFmtId), attrs.formatCode || "");
  }
  const isDate = id => (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom.has(id) && /[ymdhs]/i.test(custom.get(id).replace(/"[^"]*"|\[[^\]]*\]|\\./g, "")));
  const cellXfs = String(xml || "").match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] || "";
  return [...cellXfs.matchAll(/<xf\b[^>]*>/g)].map(([tag]) => isDate(Number(excelAttrs(tag).numFmtId || 0)));
}
function excelColumnNumber(letters) {
  return [...letters].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
}

async function excelReadWorkbook(bytes) {
  if (!bytes || bytes.byteLength > EXCEL_MAX_BYTES) throw new Error("20MB以下のExcelファイルを選んでください");
  const read = await excelUnzip(bytes);
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new Error("Excelブックの中身が見つかりません");
  const workbookRels = excelRelationships(await read("xl/_rels/workbook.xml.rels"));
  const sharedXml = await read("xl/sharedStrings.xml") || "";
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => excelInlineText(match[1]));
  const dateStyles = excelDateStyles(await read("xl/styles.xml"));
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const sheets = new Map();
  for (const [tag] of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const attrs = excelAttrs(tag);
    const target = workbookRels.get(attrs["r:id"])?.Target;
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    sheets.set(attrs.name, {path, xml: null});
  }
  async function sheet(name) {
    const entry = sheets.get(name);
    if (!entry) return null;
    if (entry.cells) return entry;
    const xml = await read(entry.path);
    const rels = excelRelationships(await read(entry.path.replace(/([^/]+)$/, "_rels/$1.rels")));
    const cells = new Map();
    for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = excelAttrs(match[1]);
      const body = match[2] || "";
      const formula = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1] ?? (/<f\b[^>]*\/>/.test(body) ? "" : undefined);
      const rawValue = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      let value = null;
      if (attrs.t === "s") value = shared[Number(rawValue)] ?? "";
      else if (attrs.t === "inlineStr") value = excelInlineText(body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] || "");
      else if (attrs.t === "str" || attrs.t === "e") value = rawValue == null ? null : excelText(rawValue);
      else if (attrs.t === "b") value = rawValue === "1";
      else if (rawValue != null && rawValue !== "") value = Number(rawValue);
      const isDate = typeof value === "number" && !!dateStyles[Number(attrs.s || 0)];
      cells.set(attrs.r, {value, isDate, formula: formula == null ? null : excelText(formula), error: attrs.t === "e"});
    }
    const hyperlinks = new Map();
    for (const [tag] of xml.matchAll(/<hyperlink\b[^>]*>/g)) {
      const attrs = excelAttrs(tag);
      const target = attrs["r:id"] ? rels.get(attrs["r:id"])?.Target ?? null : null;
      for (const ref of excelExpandRange(attrs.ref)) hyperlinks.set(ref, {target, location: attrs.location ?? null});
    }
    Object.assign(entry, {cells, hyperlinks});
    return entry;
  }
  return {sheetNames: [...sheets.keys()], sheet, date1904};
}
function excelExpandRange(ref) {
  const [start, end = start] = String(ref || "").split(":");
  const a = start.match(/^([A-Z]+)(\d+)$/), b = end.match(/^([A-Z]+)(\d+)$/);
  if (!a || !b) return [];
  const refs = [];
  for (let row = Number(a[2]); row <= Number(b[2]); row++) {
    for (let col = excelColumnNumber(a[1]); col <= excelColumnNumber(b[1]); col++) refs.push(`${excelColumnLetters(col)}${row}`);
  }
  return refs;
}
function excelColumnLetters(number) {
  let letters = "";
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  return letters;
}

// Excel stores local wall-clock values without a timezone, so they stay as offset-free ISO strings.
function excelSerialParts(serial, date1904) {
  const ms = Math.round((serial + (date1904 ? 1462 : 0) - 25569) * 86400) * 1000;
  const date = new Date(ms);
  const pad = value => String(value).padStart(2, "0");
  return {
    date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  };
}

function excelBuildSnapshot(book, meta = {}) {
  return (async () => {
    const mainName = await excelFindSheet(book, cells => excelString(cells.get("C2")) === "早番" && excelString(cells.get("H2")) === "遅番" && /TODO/.test(excelString(cells.get("L2"))));
    if (!mainName) throw new Error("TO DO シート（C2=早番・H2=遅番・L2=備考・TODO）が見つかりません。元と同じ形式のExcelを選んでください");
    const recordName = await excelFindSheet(book, cells => excelString(cells.get("A1")) === "記録日時" && excelString(cells.get("C1")) === "内容");
    const hpName = await excelFindSheet(book, cells => excelString(cells.get("A6")) === "店舗" && excelString(cells.get("B6")) === "結果");
    const main = await book.sheet(mainName);
    const cell = ref => main.cells.get(ref);
    const text = ref => excelString(cell(ref));
    const nullable = ref => text(ref) || null;
    const asIso = (entry, part) => {
      if (!entry || entry.value == null || entry.value === "") return null;
      if (typeof entry.value === "number") {
        const parts = excelSerialParts(entry.value, book.date1904);
        return part === "date" ? parts.date : part === "time" ? parts.time : `${parts.date}T${parts.time}`;
      }
      const raw = String(entry.value).trim();
      const match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (!match) return part === "time" && /^\d{1,2}:\d{2}/.test(raw) ? raw.padStart(8, "0").slice(0, 8) : null;
      const pad = value => String(value || 0).padStart(2, "0");
      const date = `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
      const time = `${pad(match[4])}:${pad(match[5])}:${pad(match[6])}`;
      return part === "date" ? date : part === "time" ? time : `${date}T${time}`;
    };
    const linkOf = ref => main.hyperlinks.get(ref)?.target || null;
    const consumed = new Set(["Q3"]);
    const use = (...refs) => refs.forEach(ref => consumed.add(ref));

    const shiftSections = {early: [], late: []};
    for (const [name, cols] of [["early", ["B", "C", "D", "E", "Z"]], ["late", ["G", "H", "I", "J", "AA"]]]) {
      const [timeCol, textCol, noteCol, checkCol, kindCol] = cols;
      for (let row = EXCEL_MAIN_ROWS[0]; row <= EXCEL_MAIN_ROWS[1]; row++) {
        use(`${timeCol}${row}`, `${textCol}${row}`, `${noteCol}${row}`, `${checkCol}${row}`, `${kindCol}${row}`);
        const formula = cell(`${textCol}${row}`)?.formula;
        // A workbook saved by a tool other than Excel may lack the cached HYPERLINK label.
        const kind = text(`${kindCol}${row}`), itemText = text(`${textCol}${row}`) || (formula?.match(/HYPERLINK\s*\(.*,\s*"([^"]+)"\s*\)\s*$/i)?.[1] ?? "");
        if (!itemText || !kind) continue;
        // Heading rows (H) show a progress formula such as "10/10" in the check column, not a check.
        const check = kind === "H" ? "" : text(`${checkCol}${row}`);
        const item = {
          id: `${name}-${row}`, sourceRow: row, kind,
          time: asIso(cell(`${timeCol}${row}`), "time"),
          text: itemText, note: nullable(`${noteCol}${row}`),
          completed: check === "✓",
          checkValue: check || null,
          url: linkOf(`${textCol}${row}`)
        };
        if (formula && /HYPERLINK\s*\(/i.test(formula)) item.sourceFormula = `=${formula}`;
        shiftSections[name].push(item);
      }
    }

    const todos = [];
    for (let row = EXCEL_MAIN_ROWS[0]; row <= EXCEL_MAIN_ROWS[1]; row++) {
      use(`L${row}`, `M${row}`, `N${row}`, `O${row}`);
      const todoText = text(`L${row}`);
      if (!todoText) continue;
      const check = text(`O${row}`);
      todos.push({id: `todo-${row}`, sourceRow: row, text: todoText, dueDate: asIso(cell(`M${row}`), "date"), owner: nullable(`N${row}`), completed: check === "✓", checkValue: check || null});
    }

    const owners = [];
    for (let row = 3; row <= 200; row++) {
      use(`Y${row}`);
      const name = text(`Y${row}`);
      if (name && !owners.includes(name)) owners.push(name);
    }

    const calendarEntries = [];
    for (let row = 5; row <= 16; row++) {
      for (const col of EXCEL_WEEK_COLUMNS) {
        const dateCell = cell(`${col}${row}`);
        if (!dateCell?.isDate) continue;
        const below = `${col}${row + 1}`;
        use(below);
        const entryText = text(below);
        if (entryText) calendarEntries.push({date: asIso(dateCell, "date"), text: entryText, sourceCell: below});
      }
    }
    // Rows 36-44 in Q/W are the growth-record input row and its on-sheet history.
    for (let row = 36; row <= 44; row++) use(`Q${row}`, `W${row}`);
    const draftText = text("Q36"), draftAuthor = text("W36");
    const handover = {text: draftText, author: draftAuthor};
    const reflectionDrafts = draftText ? [{sourceRow: 36, text: draftText, author: draftAuthor}] : [];

    const referenceLinks = [];
    for (const [ref, link] of main.hyperlinks) {
      if (!link.target) continue;
      const column = ref.match(/^[A-Z]+/)[0];
      referenceLinks.push({id: `link-${ref.toLowerCase()}`, sourceCell: ref, group: excelColumnNumber(column) <= excelColumnNumber("O") ? "task" : "quick", label: text(ref) || ref, url: link.target});
    }
    referenceLinks.sort((a, b) => excelRefOrder(a.sourceCell) - excelRefOrder(b.sourceCell));

    const baselines = new Map();
    for (let row = EXCEL_MAIN_ROWS[0]; row <= EXCEL_MAIN_ROWS[1]; row++) {
      use(`AC${row}`);
      const list = text(`AC${row}`);
      if (list && text(`C${row}`)) baselines.set(text(`C${row}`), list.split(/\r?\n/).map(item => item.trim()).filter(Boolean));
    }
    const hpStores = [];
    let hpCheck = null;
    if (hpName) {
      const hp = await book.sheet(hpName);
      const hpText = ref => excelString(hp.cells.get(ref));
      hpCheck = {lastCheckedAt: asIso(hp.cells.get("B4"), "datetime"), summary: hpText("E4") || null, checked: hpText("H4") || null};
      for (let row = 7; row <= 60; row++) {
        const name = hpText(`A${row}`);
        if (!name || !hpText(`B${row}`)) continue;
        const count = hp.cells.get(`D${row}`)?.value;
        hpStores.push({
          id: `hp-${row}`, sourceRow: row, name, status: hpText(`B${row}`) || null,
          checkedAt: asIso(hp.cells.get(`C${row}`), "datetime"),
          imageCount: count == null || count === "" || Number.isNaN(Number(count)) ? null : Number(count),
          change: hpText(`E${row}`) || null, detail: hpText(`F${row}`) || null,
          url: hp.hyperlinks.get(`G${row}`)?.target || null,
          imageUrlBaseline: baselines.get(name) || []
        });
      }
    }

    const records = [];
    if (recordName) {
      const sheet = await book.sheet(recordName);
      let blank = 0;
      for (let row = 2; row <= 100000 && blank < 20; row++) {
        const body = sheet.cells.get(`C${row}`), at = sheet.cells.get(`A${row}`);
        if ((body?.value == null || body.value === "") && (at?.value == null || at.value === "")) { blank++; continue; }
        blank = 0;
        records.push({id: `record-${row}`, sourceRow: row, recordedAt: asIso(at, "datetime"), author: excelString(sheet.cells.get(`B${row}`)), text: excelString(body, false)});
      }
    }

    const supplementaryCells = [];
    for (const [ref, entry] of [...main.cells].sort(([a], [b]) => excelRefOrder(a) - excelRefOrder(b))) {
      const row = Number(ref.match(/\d+$/)[0]);
      if (row < 2 || consumed.has(ref) || entry.formula != null || entry.error || entry.value == null || entry.value === "") continue;
      supplementaryCells.push({sourceCell: ref, value: entry.isDate ? asIso(entry, "datetime") : entry.value});
    }

    return {
      source: {fileName: meta.fileName || "", sha256: meta.sha256 || "", modifiedAt: meta.modifiedAt || null, extractedAt: meta.extractedAt || null,
        dateSemantics: "Excel local date/time values have no embedded timezone; ISO values are kept without offset.", path: meta.path || ""},
      shiftSections, todos, records, hpStores, referenceLinks, owners,
      settings: {calendarMonth: text("Q3") || null, calendarEntries, handover, reflectionDrafts, hpCheck, supplementaryCells},
      sheets: {main: mainName, records: recordName, hp: hpName}
    };
  })();
}
function excelString(entry, trim = true) {
  if (!entry || entry.value == null || entry.error) return "";
  const value = (typeof entry.value === "boolean" ? (entry.value ? "TRUE" : "FALSE") : String(entry.value)).replace(/\r\n?/g, "\n");
  return trim ? value.trim() : value;
}
function excelRefOrder(ref) {
  const [, col, row] = ref.match(/^([A-Z]+)(\d+)$/);
  return Number(row) * 1000 + excelColumnNumber(col);
}
async function excelFindSheet(book, test) {
  for (const name of book.sheetNames) {
    const sheet = await book.sheet(name);
    if (sheet && test(sheet.cells)) return name;
  }
  return null;
}

// Excel is the source of truth for the daily sheet (checklist, TODO, calendar, memo).
// Nothing the app alone knows is dropped: records are merged, removed TODOs go to the archive,
// and app-made links, calendar entries and settings stay as they are.
// `resolvedLinks` maps each Excel hyperlink to the target the app may open, or null to skip it.
function excelMergeIntoState(current, snapshot, resolvedLinks = new Map(), now = null) {
  const next = JSON.parse(JSON.stringify(current));
  const summary = {checklist: 0, checklistChanged: 0, todos: 0, todosArchived: [], recordsAdded: 0, ownersAdded: [], linksAdded: 0, linksUpdated: 0, linksSkipped: [], calendarEntries: 0, hpUpdated: 0};
  const target = url => {
    if (!url) return null;
    const resolved = resolvedLinks.has(url) ? resolvedLinks.get(url) : url;
    if (!resolved && !summary.linksSkipped.includes(url)) summary.linksSkipped.push(url);
    return resolved || null;
  };

  const previousItems = new Map(Object.values(current.shiftSections || {}).flat().map(item => [item.id, item]));
  next.shiftSections = {...next.shiftSections};
  for (const name of ["early", "late"]) {
    next.shiftSections[name] = snapshot.shiftSections[name].map(item => ({...item, url: target(item.url)}));
    summary.checklist += next.shiftSections[name].length;
    summary.checklistChanged += next.shiftSections[name].filter(item => {
      const before = previousItems.get(item.id);
      return !before || before.text !== item.text || before.kind !== item.kind || (before.note || null) !== item.note || (before.time || null) !== item.time;
    }).length;
  }

  const importedTodos = new Set(snapshot.todos.map(todo => todo.id));
  next.todoArchive = Array.isArray(next.todoArchive) ? next.todoArchive : [];
  for (const todo of current.todos || []) {
    if (importedTodos.has(todo.id)) continue;
    next.todoArchive.push({...todo, archivedAt: now, archivedReason: todo.completed ? "Excel取込み（完了済み）" : "Excel取込み（Excelに無い未完了）"});
    if (!todo.completed) summary.todosArchived.push(todo.text);
  }
  // Repeat, priority and category exist only in the app; keep them while the Excel row still holds the same TODO.
  const appOnlyTodoFields = ["repeat", "repeatDay", "repeatNextId", "priority", "category"];
  const currentTodos = new Map((current.todos || []).map(todo => [todo.id, todo]));
  next.todos = snapshot.todos.map(todo => {
    const before = currentTodos.get(todo.id);
    if (!before || before.text !== todo.text) return {...todo};
    const kept = Object.fromEntries(appOnlyTodoFields.filter(field => before[field] != null).map(field => [field, before[field]]));
    return {...todo, ...kept};
  });
  summary.todos = next.todos.length;

  const recordKey = record => `${String(record.recordedAt || "").slice(0, 16)}|${String(record.text || "").replace(/\s+/g, "")}`;
  // Records edited or deleted in the app keep their id and time, so Excel does not bring back the old copy.
  const appRecords = [...(current.records || []), ...(current.recordTrash || [])];
  const knownRecords = new Set(appRecords.map(recordKey));
  const knownRows = new Set(appRecords.map(record => `${record.id}|${String(record.recordedAt || "").slice(0, 16)}`));
  const recordIds = new Set(appRecords.map(record => record.id));
  for (const record of snapshot.records) {
    const key = recordKey(record);
    if (knownRecords.has(key) || knownRows.has(`${record.id}|${String(record.recordedAt || "").slice(0, 16)}`)) continue;
    knownRecords.add(key);
    let id = record.id;
    for (let n = 2; recordIds.has(id); n++) id = `${record.id}-${n}`;
    recordIds.add(id);
    next.records.push({...record, id});
    summary.recordsAdded++;
  }

  next.owners = Array.isArray(next.owners) ? next.owners : [];
  for (const name of snapshot.owners) if (!next.owners.includes(name)) { next.owners.push(name); summary.ownersAdded.push(name); }

  // Links that came from Excel keep their app-side department; their target follows Excel.
  next.referenceLinks = Array.isArray(next.referenceLinks) ? next.referenceLinks : [];
  const linksById = new Map(next.referenceLinks.map(link => [link.id, link]));
  const targets = new Set(next.referenceLinks.map(link => link.url));
  for (const link of snapshot.referenceLinks) {
    const url = target(link.url);
    if (!url) continue;
    const existing = linksById.get(link.id);
    if (existing) {
      if (existing.url !== url) { existing.url = url; existing.label = link.label; targets.add(url); summary.linksUpdated++; }
      continue;
    }
    if (targets.has(url)) continue;
    const added = {...link, url, department: ""};
    next.referenceLinks.push(added); linksById.set(added.id, added); targets.add(url);
    summary.linksAdded++;
  }
  // A checklist button only opens targets that are registered links, so register any stragglers.
  for (const item of Object.values(next.shiftSections).flat()) {
    if (!item.url || targets.has(item.url)) continue;
    let id = `link-${item.id}`;
    for (let n = 2; linksById.has(id); n++) id = `link-${item.id}-${n}`;
    const added = {id, sourceCell: null, group: "task", label: item.text, department: "", url: item.url};
    next.referenceLinks.push(added); linksById.set(id, added); targets.add(item.url);
    summary.linksAdded++;
  }

  // Only stores the app already monitors are updated, and only by a newer check.
  next.hpStores = Array.isArray(next.hpStores) ? next.hpStores : [];
  for (const store of snapshot.hpStores) {
    const existing = next.hpStores.find(item => item.id === store.id && item.name === store.name);
    if (!existing || String(store.checkedAt || "") <= String(existing.checkedAt || "")) continue;
    Object.assign(existing, {status: store.status, checkedAt: store.checkedAt, imageCount: store.imageCount, change: store.change, detail: store.detail, checkError: null,
      imageUrlBaseline: store.imageUrlBaseline.length ? store.imageUrlBaseline : existing.imageUrlBaseline});
    delete existing.lastImportedDiff;
    summary.hpUpdated++;
  }

  next.settings = {...(next.settings || {})};
  const sheet = snapshot.settings;
  const excelEntries = sheet.calendarEntries.map(entry => ({id: `xl-${entry.sourceCell}-${entry.date}`, ...entry}));
  const excelEntryKeys = new Set(excelEntries.map(entry => `${entry.date}|${entry.text}`));
  const appEntries = (next.settings.calendarEntries || []).filter(entry => !entry.sourceCell && !excelEntryKeys.has(`${entry.date}|${entry.text}`));
  next.settings.calendarEntries = [...excelEntries, ...appEntries];
  summary.calendarEntries = excelEntries.length;
  next.settings.calendarMonth = sheet.calendarMonth;
  if (sheet.handover.text || !next.settings.reflectionDrafts?.length) {
    next.settings.handover = sheet.handover;
    next.settings.reflectionDrafts = sheet.reflectionDrafts;
  }
  next.settings.supplementaryCells = sheet.supplementaryCells;
  if (sheet.hpCheck?.lastCheckedAt && String(sheet.hpCheck.lastCheckedAt) > String(next.settings.hpCheck?.lastCheckedAt || "")) {
    next.settings.hpCheck = {...next.settings.hpCheck, ...sheet.hpCheck};
  }
  next.source = {...snapshot.source, importedAt: now};
  return {state: next, summary};
}

async function excelSha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

if (typeof module !== "undefined") module.exports = {excelReadWorkbook, excelBuildSnapshot, excelMergeIntoState, excelSha256};
