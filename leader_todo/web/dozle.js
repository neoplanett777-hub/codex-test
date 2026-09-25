"use strict";

// ドズル社風テーマ。ブロック風UIで業務の進み具合を演出する。メンバーの絵は、利用者が登録した画像があればそれを、
// なければここで描いた自作ドット絵を使う。見た目と音だけで、業務データは変えない。

const dozleMode = () => typeof uiTheme === "function" && uiTheme() === "dozle";

// ---------- Members (colours and motifs taken from the public member page; artwork below is original) ----------
const DOZLE_MEMBERS = {
  qnly:   {name: "おんりー", latin: "QNLY", color: "#f7c600", ink: "#2a2100", friend: "fox", line: "静かに、最速で。"},
  dozle:  {name: "ドズル", latin: "DOZLE", color: "#c8141e", ink: "#ffffff", friend: "gorilla", line: "よし、みんなで行こう！"},
  bonjour:{name: "ぼんじゅうる", latin: "BONJOUR", color: "#6d3f9c", ink: "#ffffff", friend: "bird", line: "ゆるっと、でも決める。"},
  oraf:   {name: "おらふくん", latin: "ORAF-KUN", color: "#54c3f1", ink: "#0d2b3d", friend: "snowman", line: "今日も元気にいこー！"},
  men:    {name: "おおはらMEN", latin: "OOHARAMEN", color: "#e8698f", ink: "#ffffff", friend: "owl", line: "慎重に、確実に。"}
};
const DOZLE_ORDER = ["dozle", "bonjour", "qnly", "oraf", "men"];
const dozleFace = key => key === "qnly" ? "qnlyFace" : key;
const dozleOshi = () => DOZLE_MEMBERS[state?.settings?.dozleOshi] ? state.settings.dozleOshi : "qnly";

// ---------- Pixel sprites: one letter per pixel (おんりー is drawn larger, 24x40, for more detail) ----------
const DOZLE_SPRITES = {
  qnly: {pal: {c:"#8ee7ee",K:"#15151c",H:"#1e3b3b",h:"#2f6b66",d:"#0f2323",S:"#f7d6bd",s:"#e0ad90",G:"#1a1a20",g:"#bfe9ee",E:"#35c27a",e:"#15603a",W:"#ffffff",w:"#d5dbe5",V:"#202028",v:"#3a3a46",T:"#d42a78",t:"#9c1c57",F:"#e3263b",f:"#ffd24a",Y:"#f7b822",y:"#cf860a",P:"#1b1b22",p:"#30303c",B:"#5a3a22",N:"#ffe04a",n:"#c9a118",M:"#b8665a"}, rows: [
    "............Hh..........", "...........HH...........", ".......HHHHHHHHHh.......", "....HHHHhhHHHHHHHHH.H...", "...HHHHhHHHHHHhhHHHHH...", "..HHHHHHHHHHHHHHHHHHHH..",
    "...HHHHHHHHHHHHHHHHHHH..", "..HHHHdHHHHdHHHHHdHHHH..", "..HHHdSdHHdSSdHHHSdHHH..", "..HHHSSSSdSSSSSSSSSSHH..", "..HHSGGGGGSGGSGGGGGSHH..", "..HHSGSccGSSSSGccSGSHH..",
    "..HHSGSEeGSSSSGeESGSHH..", "..HsSGGGGGSSSSGGGGGSsH.N", "...sSSSSSSSSSSSSSSSSs.NN", "....SSSSSSSSMSSSSSSS.NNn", ".....sSSSSSSSSSSSSs.SSn.", ".......sSSSSSSSSs...SSS.",
    ".........WWSSWW....SS...", ".......WWWVTTVWWW.SS....", ".....WWWVVVTTVVVWWWw....", "....WWwVVVVTtVVVVwW.....", "....WWwVFfVTTVVVVVw.....", "....WWwVVFVTtVVVVVw.....",
    "....WwwVVVVTTVVVVVw.....", "....SSwVVVVTtVVVVVw.....", "....SSVVVVVVVVVVVVV.....", "...YYYYYYYYYYYYYYYYY....", "..YYyYYYYYYYYYYYYYyY....", "..YyYYyPPPPPPPPPPy......",
    "..YYyy.PPPPPPPPPPP......", "...Yy..PPPPPPPPPPP......", "...yY..PPPpPPPpPPP......", "....y..PPPp..PpPPP......", ".......PPPp..PpPPP......", ".......PPPp..PpPPP......",
    ".......PPPp..PpPPP......", ".......PPPP..PPPP.......", "......BBBBB..BBBBB......", "......KKKKK..KKKKK......"]},
  // おんりーの顔アップ（32x32）: サイドバーと通知で使う
  qnlyFace: {pal: {H:"#1f3d3d",h:"#3b7c77",d:"#0e2424",S:"#f8dcc6",s:"#e4b69c",K:"#141418",k:"#2a4a4a",c:"#8ee7ee",E:"#39c27c",e:"#176040",O:"#ffffff",M:"#8a4a44",W:"#ffffff",w:"#dfe1ec",V:"#2b2320",v:"#44372f",T:"#c8226e",t:"#8f1850",R:"#d8303f",r:"#9e1d2c",f:"#f4d04a",N:"#ffe46a",n:"#d9b52a"}, rows: [
    "................HH..............", "...............H..H.............", "...............HH...............", "...........HHHHHHHHHH...........",
    "........HHHHhhHHHHHHHHHH........", ".....HHHHHHhHHHHHHHhhHHHHHH.....", ".HH.HHHHHHhHHHHHHHHHhhHHHHHH.HH.", "..HHHHHHhHHhHHHHHHHHHhHHHHHHHH..",
    "..HHHHHHHHHHhHHHdHHHHHhHHHHHHH..", "HHHHHhHHHdHHHHdHHHHHHHHdHhhHHHH.", ".HHHHHhHHdHHHHdHHHdHHHHHdHhhHHHH", "..HHhHHHdHHHHHHHHHdHHHHHHdHHHH..",
    "..HHHHHHSHHSSHHHSSSHHSHHHHHHHH..", "..HHdHHSHSHSSSHHSSSSHSSHSHHdHH..", ".HHhHHHKKKKKKKKHSKKKKKKKKHHdHHH.", "..HHdHKKSkkkSSKKKKSkkkSSKKHHhH..",
    "..HHHHHKSOccSSKSSKSOccSSKHHHhH..", ".HHhHHHKSEeESSKSSKSEeESSKHHHHHH.", "..HHhHHKKKKKKKKSSKKKKKKKKHHhHH..", "HHHHHdHHsSSSSSSSSSNnSSSsHHdHHHHH",
    "..HHHHHHHSSSSSSMMSNNSSSHHHHHHH..", "...HHH.....SSSMSSMNNN.....HHH...", "....H.......WSSSSNNNNN.....H....", "..........WWWWssNsNNNWN.........",
    "........WWWWwWWTTnnnnnWW........", "...VVVVRVVVVWWWTTSSSSSVVVVVVV...", "...vrVVRVVrVWWTtWssssSVVVVVVv...", "wwwvVRRRRRVVWWTtWSSSSsVVVVVVvwww",
    "wwwVvVRORVVVVWTtWssssSVVVVVvVwww", "wwwVvRRRRRVVVTtWWWSSSSVVVVVvVwww", "wwwVrvVVVVrVVTtWWWWWWWWWVVvVVwww", "wwwVVvVVVVVVVTtWWWWWWWWWVVvVVwww"]},
  oraf: {pal: {K:"#1b1b22",U:"#2f63c8",O:"#ffffff",H:"#eef1f6",h:"#c3cad6",S:"#f7d8c2",s:"#e6b9a0",E:"#3a6fd8",W:"#fbfbfd",w:"#d9dee8",R:"#d2344a",L:"#3aa0e0",P:"#26307a",p:"#e8ecf6",B:"#f4f4f4"}, rows: [
    "......UUU.......", ".....UUUUU......", "......OOO.......", ".....OKOKO......", "....HHHHHHHH....", "...HHhHHHHhHH...",
    "..HHHHHHHHHHHH..", "..HHHSHHSHHHHH..", "..HHSSSSSSSSHH..", "..HSSESSSSESSH..", "..HSSSSSSSSSSH..", "...SSSSKKSSSS...",
    "....sSSSSSSs....", "...WWWWKWWWW....", ".WWWWWWWWWWWWWW.", "WWWwWWWWWWWWwWWW", "WRLwWWWWWWWWwLRW", "SWWwWWWWWWWWwWWS",
    ".WWWWWWWWWWWWWW.", "..wWWWWWWWWWWw..", "...PPPPPPPPPP...", "...PpPP..PPpP...", "...PpP....PpP...", "...PpP....PpP...",
    "...PpP....PpP...", "...PpP....PpP...", "..BBBB....BBBB..", "..KKKK....KKKK.."]},
  dozle: {pal: {K:"#2a1a10",H:"#f2c64a",h:"#d9a632",S:"#f3cfb0",s:"#d9a883",M:"#e6b43a",E:"#6b3b1a",R:"#c8141e",r:"#8f0e15",L:"#4a2a1a",g:"#f0c040",B:"#5a3a24"}, rows: [
    ".....H..H.H.....", "....HHHHHHHH....", "...HhHHHhHHHH...", "...HHHHHHHHHH...", "...HSSSSSSSSH...", "...SSKSSSSKSS...",
    "...SSESSSSESS...", "...SSSSssSSSS...", "...SMMMMMMMMS...", "....SSSKKSSS....", ".....SSSSSS.....", "..SSSSSSSSSSSS..",
    ".SSSSsSSSSsSSSS.", ".SSS.SSSSSS.SSS.", ".SS..SsSSsS..SS.", ".SS..SSSSSS..SS.", ".Ss..SsSSsS..sS.", "..S..LLgLLL..S..",
    "....RRRRRRRR....", "....RRRRRRRR....", "....RRR..RRR....", "....RRr..rRR....", "....RRr..rRR....", "....RRr..rRR....",
    "....RRr..rRR....", "....RRr..rRR....", "...BBBB..BBBB...", "................"]},
  bonjour: {pal: {K:"#1b1b22",H:"#1c1c24",h:"#3a3a52",S:"#f3d2b8",G:"#111114",g:"#6a4a8a",T:"#1f2a44",W:"#f2f2f7",J:"#2a2433",j:"#3d3450",P:"#2b2536",B:"#6a4526"}, rows: [
    "....HHHHHHH.....", "...HHHhHHHHH....", "..HHHHHHHHHHH...", "..HHHHHHhHHHH...", "...HHSSSSSSHH...", "...HSSSSSSSSH...",
    "...SGGGSSGGGS...", "...SGgGGGGgGS...", "...SSSSSSSSSS...", "....SSSKKSSS....", ".....SSSSSS.....", "..JJTTTTTTTTJJ..",
    ".JJjTTTTTTTTjJJ.", ".JJTTWTTTWTTTJJ.", ".JJTWWWTTWWTTJJ.", ".JJTTWTTWTTWTJJ.", ".JJTTWWTTWWTTJJ.", ".SJTTTTTTTTTTJS.",
    "..J.PPPPPPPP.J..", "....PPPPPPPP....", "....PPP..PPP....", "....PPP..PPP....", "....PPP..PPP....", "....PPP..PPP....",
    "....PPP..PPP....", "....PPP..PPP....", "...BBBB..BBBB...", "................"]},
  men: {pal: {K:"#f3a3b5",k:"#d97f96",N:"#8a3a50",G:"#b5822e",L:"#5fd0d6",E:"#3a2020",M:"#8e2a55",m:"#b23c6c",J:"#262028",W:"#f2f2f2",D:"#6a4a2e",d:"#4e3520",Z:"#8a8f96"}, rows: [
    "...kK......Kk...", "...KKKKKKKKKK...", "..KGLLGKKGLLGK..", "..KGGGGGGGGGGK..", "..KKKKKKKKKKKK..", "..KKEKKKKKKEKK..",
    "..KKKkkkkkkKKK..", "..KKKkNkkNkKKK..", "..KKKkkkkkkKKK..", "...KKKKKKKKKK...", "..MMMKKKKKKMMM..", ".JWMMMMMMMMMMWJ.",
    "JWWJmMMMMMMmJWWJ", "JWWJMmmmmmmMJWWJ", "JWWJMmMMMMmMJWWJ", "JWWJMMMMMMMMJWWJ", "KWWJJJJJJJJJJWWK", "...DDDDDDDDDD...",
    "..DDDDDDDDDDDD..", "..DDDDd..dDDDD..", "..DDDD....DDDD..", "..DDDD....DDDD..", "..DdDD....DDdD..", "..DDDD....DDDD..",
    "..DDDD....DDDD..", ".ZZZZZ....ZZZZZ.", "................", "................"]},
  // おともだち (small, 10x10)
  fox: {pal: {W:"#ffffff",w:"#e9e4de",O:"#f39a2b",o:"#d9761a",K:"#2a2a2a",P:"#f28aa0",F:"#e3263b"}, rows: [
    "O.......O.", "OO.....OO.", "OWWWWWWWO.", "WWKWWWKWW.", "WWWWPWWWWO", ".WWWWWWWOO", "..OWWWOOFO", "..WWwWWOOO", "..W.W.W.O.", ".........."]},
  gorilla: {pal: {G:"#55575c",g:"#8a8d94",K:"#1b1b1f",F:"#b9bcc2",R:"#d9262f"}, rows: [
    "..GGGGGG..", ".GGGGGGGG.", "GGFFFFFFGG", "GGFKFFKFGG", "GGFFFFFFGG", ".GFFKKFFG.", "GGGGGGGGGG", "GgGGRGGGgG", "GG.GGGG.GG", ".........."]},
  bird: {pal: {P:"#5b3a86",p:"#7d58ad",K:"#111114",Y:"#f0b429",W:"#ffffff"}, rows: [
    "....PP....", "...PPPP...", "..PPPPPP..", ".PKKKKKKP.", ".PKWKKWKP.", ".PPPYYPPP.", ".pPPPPPPp.", "..pPPPPp..", "...Y..Y...", ".........."]},
  snowman: {pal: {U:"#2f63c8",u:"#1d3f8a",O:"#ffffff",o:"#dce6f0",K:"#1b1b22",R:"#d9262f",L:"#6fd3f5"}, rows: [
    "...UUUU...", "...UUUU...", "..uuuuuu..", "..OOOOOO..", "..OKOOKO..", "..OOOOOO..", ".RRRRRRRR.", ".OOLOOLOO.", "..oOOOOo..", ".........."]},
  owl: {pal: {W:"#f2efe9",w:"#d6d0c6",G:"#c9923a",L:"#7fd9e0",K:"#2a2020",P:"#e0708f",B:"#8a6a4a"}, rows: [
    "P........P", ".WWWWWWWW.", "WGGGWWGGGW", "WGLLGGLLGW", "WGGGWWGGGW", "WWWWBBWWWW", "PWWwWWwWWP", ".WWWWWWWW.", "..W....W..", ".........."]}
};

// Consecutive pixels of one colour become one rect, so a sprite stays a few hundred bytes.
function dozleSprite(name, cls = ""){
  const sprite = DOZLE_SPRITES[name]; if (!sprite) return "";
  const width = sprite.rows[0].length, height = sprite.rows.length;
  let rects = "";
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1; while (end < row.length && row[end] === ch) end++;
      if (ch !== "." && sprite.pal[ch]) rects += `<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${sprite.pal[ch]}"/>`;
      x = end;
    }
  });
  return `<svg class="dz-sprite ${cls}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// ---------- Pictures the user adds (kept on this PC by the desktop host, never in shared JSON) ----------
let DZ_IMAGES = {};
const DZ_IMAGE_KINDS = {body: {label: "全身", max: 900}, face: {label: "顔", max: 320}};
async function dozleLoadImages(){
  try { DZ_IMAGES = await window.pywebview?.api?.get_theme_images?.() || {}; } catch { DZ_IMAGES = {}; }
  if (typeof render === "function" && state) render();
}
window.addEventListener("pywebviewready", () => setTimeout(dozleLoadImages, 0), {once: true});
// A registered picture replaces the pixel art. The face slot falls back to the top of the full-body picture.
function dozleArt(key, kind, cls = ""){
  const own = DZ_IMAGES[`${key}:${kind}`];
  if (own) return `<img class="dz-art ${kind} ${cls}" src="${own}" alt="" draggable="false">`;
  if (kind === "face" && DZ_IMAGES[`${key}:body`]) return `<img class="dz-art face from-body ${cls}" src="${DZ_IMAGES[`${key}:body`]}" alt="" draggable="false">`;
  return dozleSprite(kind === "face" ? dozleFace(key) : key, cls);
}
// Shrinks the chosen picture in the page so a phone photo does not bloat the saved file.
function dozleShrinkImage(file, max){
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { reject(new Error("PNG・JPEG・WebP の画像を選んでください")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像を読み込めませんでした"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        let data = canvas.toDataURL("image/webp", .9);
        if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/png");
        resolve(data);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
let dozlePendingImage = null;
async function dozleSaveImage(key, data){
  const api = window.pywebview?.api;
  if (!api?.save_theme_image) throw new Error("画像を保存できませんでした");
  await api.save_theme_image(key, data);
  if (data) DZ_IMAGES[key] = data; else delete DZ_IMAGES[key];
  render();
}
function dozleImageManager(){
  return `<div class="dz-image-manager"><strong>メンバー画像</strong><p class="note">お手持ちの画像を登録すると、ドット絵の代わりに表示します。「全身」はホームのカードと演出、「顔」はサイドバー・通知・メンバー一覧に使います（顔が未登録なら全身画像の上の部分を使います）。画像はこのPCだけに保存し、共有用のJSONには含めません。</p>
    <div class="dz-image-rows">${DOZLE_ORDER.map(key => `<div class="dz-image-row" style="--mc:${DOZLE_MEMBERS[key].color}"><span class="dz-image-name">${esc(DOZLE_MEMBERS[key].name)}</span>${Object.entries(DZ_IMAGE_KINDS).map(([kind, info]) => { const id = `${key}:${kind}`, has = !!DZ_IMAGES[id]; return `<div class="dz-image-slot"><span class="dz-image-thumb ${kind}">${dozleArt(key, kind)}</span><div class="dz-image-actions"><button type="button" class="secondary" data-action="dz-pick-image" data-key="${id}">${info.label}を${has ? "変更" : "登録"}</button>${has ? `<button type="button" class="icon-button" data-action="dz-remove-image" data-key="${id}">削除</button>` : ""}</div></div>`; }).join("")}</div>`).join("")}</div>
    <input type="file" id="dz-image-input" accept="image/png,image/jpeg,image/webp" hidden></div>`;
}
document.addEventListener("change", async event => {
  if (event.target.id !== "dz-image-input" || !dozlePendingImage) return;
  const file = event.target.files?.[0], key = dozlePendingImage;
  event.target.value = ""; dozlePendingImage = null;
  if (!file) return;
  try {
    const data = await dozleShrinkImage(file, DZ_IMAGE_KINDS[key.split(":")[1]].max);
    await dozleSaveImage(key, data);
    flash("画像を登録しました");
  } catch (error) { flash(`画像を登録できませんでした: ${error.message}`); }
});

// ---------- A tiny 5x7 pixel font for Latin headings ----------
const DZ_FONT = {
  A:"01110100011000111111100011000110001",B:"11110100011000111110100011000111110",C:"01111100001000010000100001000001111",D:"11110100011000110001100011000111110",
  E:"11111100001000011110100001000011111",F:"11111100001000011110100001000010000",G:"01111100001000010111100011000101111",H:"10001100011000111111100011000110001",
  I:"11111001000010000100001000010011111",J:"00111000010000100001100011000101110",K:"10001100101010011000101001001010001",L:"10000100001000010000100001000011111",
  M:"10001110111010110101100011000110001",N:"10001110011010110011100011000110001",O:"01110100011000110001100011000101110",P:"11110100011000111110100001000010000",
  Q:"01110100011000110001101011001001101",R:"11110100011000111110101001001010001",S:"01111100001000001110000010000111110",T:"11111001000010000100001000010000100",
  U:"10001100011000110001100011000101110",V:"10001100011000110001100010101000100",W:"10001100011000110101101011010101010",X:"10001100010101000100010101000110001",
  Y:"10001100010101000100001000010000100",Z:"11111000010001000100010001000011111",0:"01110100011001110101110011000101110",1:"00100011000010000100001000010001110",
  2:"01110100010000100010001000100011111",3:"11110000010000101110000010000111110",4:"00010001100101010010111110001000010",5:"11111100001111000001000011000101110",
  6:"01110100001000011110100011000101110",7:"11111000010001000100010000100001000",8:"01110100011000101110100011000101110",9:"01110100011000101111000010000101110",
  "/":"00001000010001000100010001000010000","-":"00000000000000011111000000000000000","'":"00100001000100000000000000000000000","!":"00100001000010000100001000000000100",
  ".":"00000000000000000000000000110001100","·":"00000000000000001100011000000000000","&":"01100100101010001000101011001001101"," ":"00000000000000000000000000000000000"
};
function dozlePixelText(text, cls = ""){
  const chars = [...String(text).toUpperCase()].map(c => DZ_FONT[c] ? c : " ");
  let rects = "";
  chars.forEach((c, i) => { const bits = DZ_FONT[c]; for (let p = 0; p < 35; p++) if (bits[p] === "1") rects += `<rect x="${i * 6 + p % 5}" y="${Math.floor(p / 5)}" width="1" height="1"/>`; });
  return `<svg class="dz-pixel-text ${cls}" viewBox="0 0 ${Math.max(1, chars.length * 6 - 1)} 7" shape-rendering="crispEdges" role="img" aria-label="${esc(text)}" fill="currentColor">${rects}</svg>`;
}
// Vertical variant for the member cards: letters run top to bottom, each turned a quarter clockwise.
function dozlePixelTextVertical(text){
  const chars = [...String(text).toUpperCase()].map(c => DZ_FONT[c] ? c : " ");
  let rects = "";
  chars.forEach((c, i) => { const bits = DZ_FONT[c]; for (let p = 0; p < 35; p++) if (bits[p] === "1") rects += `<rect x="${6 - Math.floor(p / 5)}" y="${i * 6 + p % 5}" width="1" height="1"/>`; });
  return `<svg class="dz-pixel-text vertical" viewBox="0 0 7 ${Math.max(1, chars.length * 6 - 1)}" shape-rendering="crispEdges" role="img" aria-label="${esc(text)}" fill="currentColor">${rects}</svg>`;
}
// Page eyebrows ("DAILY CHECKLIST" …) are re-drawn in the pixel font after each render.
function dozlePixelHeadings(){
  document.querySelectorAll("main .eyebrow:not([data-dz])").forEach(el => {
    const text = el.textContent.trim(); if (!text || !/^[\x20-\x7e·]+$/.test(text)) return;
    el.dataset.dz = "1"; el.innerHTML = dozlePixelText(text);
  });
}

// ---------- Cards ----------
function dozleMemberCard(key, {big = false, tilt = 0} = {}){
  const m = DOZLE_MEMBERS[key];
  return `<div class="dz-card${big ? " big" : ""}" style="--mc:${m.color};--mi:${m.ink};--tilt:${tilt}deg"><div class="dz-card-inner"><span class="dz-card-latin">${dozlePixelTextVertical(m.latin)}</span><span class="dz-card-name">${esc(m.name)}</span>${dozleArt(key, "body", "dz-card-body")}<span class="dz-card-friend">${dozleSprite(m.friend)}</span></div></div>`;
}
function dozleHero(){
  const oshi = dozleOshi(), m = DOZLE_MEMBERS[oshi];
  return `<div class="dz-hero-art" aria-hidden="true">${dozleMemberCard(oshi, {big: true, tilt: 3})}</div><div class="dz-hero-quote" style="--mc:${m.color}"><b>${esc(m.name)}</b>「${esc(m.line)}」</div>`;
}

// ---------- Sidebar: level, XP bar and hearts ----------
function dozleLevel(count){ let level = 0, need = 3, left = count; while (left >= need) { left -= need; level++; need = Math.min(15, need + 1); } return {level, progress: left / need}; }
function dozleHearts(value){ const full = Math.round(value * 10); return Array.from({length: 10}, (_, i) => `<i class="dz-heart ${i < full ? "on" : ""}"></i>`).join(""); }
function renderDozleVitals(){
  if (!dozleMode() || !state) return;
  document.body.classList.add("dz-on");
  const box = $("#garo-vitals");
  const me = typeof currentUser === "function" ? currentUser() : "";
  const records = (state.records || []).filter(r => !me || r.author === me);
  const {level, progress} = dozleLevel(records.length);
  const early = countShift("early"), late = countShift("late"), total = early.total + late.total, done = early.done + late.done;
  const open = pendingTodos(), overdue = open.filter(t => dateKey(t.dueDate) && dateKey(t.dueDate) < today()).length;
  if (box) box.innerHTML = `<div class="dz-vitals-head"><span class="dz-vitals-face">${dozleArt(dozleOshi(), "face")}</span><div><strong>${esc(me || "プレイヤー")}</strong><small>Lv.${level} · 記録 ${records.length}</small></div></div><div class="dz-hearts" title="日次チェック ${done}/${total}">${dozleHearts(total ? done / total : 0)}</div><div class="dz-food" title="期限内のTODO">${dozleHearts(open.length ? (open.length - overdue) / open.length : 1).replaceAll("dz-heart", "dz-drum")}</div><div class="dz-xp"><i style="width:${Math.round(progress * 100)}%"></i><b>${level}</b></div>`;
  const holds = $("#garo-holds");
  if (holds) {
    const next = open.slice(0, 9);
    holds.innerHTML = `<span class="dz-hotbar-label">${dozlePixelText("TODO")}</span>${Array.from({length: 9}, (_, i) => { const t = next[i]; if (!t) return `<i class="dz-slot"></i>`; const due = dateKey(t.dueDate), tier = due && due < today() ? "over" : due === today() ? "today" : t.priority === "high" ? "high" : "normal"; return `<button type="button" class="dz-slot filled tier-${tier}" data-view="todos" title="${esc(t.text)}" aria-label="${esc(t.text)}"><span>${i + 1}</span></button>`; }).join("")}`;
  }
  dozlePixelHeadings();
}

// ---------- Banner: member line-up and the checklist as an RTA ----------
function dozleBanner(sections){
  if (!dozleMode()) return "";
  const counts = sections.map(countShift), done = counts.reduce((n, c) => n + c.done, 0), total = counts.reduce((n, c) => n + c.total, 0);
  const scope = sections.length > 1 ? "早番・遅番" : sections[0] === "early" ? "早番" : "遅番";
  const left = total - done, oshi = DOZLE_MEMBERS[dozleOshi()];
  const status = !total ? "チェック項目を用意しよう" : !left ? `${scope}チェック完全クリア！ RTA 完走` : left === 1 ? `ラストスパート！ ${scope}あと 1 件` : `${scope}チェック あと ${left} 件`;
  const lineup = DOZLE_ORDER.map((key, i) => `<span class="dz-mini${key === dozleOshi() ? " oshi" : ""}" style="--mc:${DOZLE_MEMBERS[key].color}" title="${esc(DOZLE_MEMBERS[key].name)}">${dozleArt(key, "face")}</span>`).join("");
  return `<div class="dz-banner${!left && total ? " clear" : ""}" role="status" style="--mc:${oshi.color}"><div class="dz-lineup" aria-hidden="true">${lineup}</div><div class="dz-banner-text"><strong>${esc(status)}</strong><span>${total ? `${done}/${total} 完了` : ""}</span><div class="dz-progress"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div></div></div>`;
}

// ---------- 8-bit sounds (reuse the synthesiser in garo.js; same on/off switch) ----------
const dozleSfx = {
  pop(){ if (typeof garoTone === "function") { garoTone(988, .06, {type: "square", gain: .06}); garoTone(1319, .08, {type: "square", gain: .06, when: .06}); } },
  xp(){ if (typeof garoTone === "function") for (let i = 0; i < 4; i++) garoTone(1568 + i * 180, .05, {type: "square", gain: .04, when: i * .05}); },
  advance(){ if (typeof garoTone === "function") [659, 784, 988, 1319].forEach((f, i) => garoTone(f, .12, {type: "square", gain: .06, when: i * .09})); },
  clear(){ if (typeof garoTone === "function") { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => garoTone(f, .14, {type: "square", gain: .07, when: i * .12})); garoTone(1047, .8, {type: "triangle", gain: .06, when: .75}); } }
};

// ---------- Performances ----------
function dozleToast(title, text, key = dozleOshi()){
  garoAnnounce?.(`${title} ${text}`);
  if (garoReducedMotion?.()) { flash(`${title}：${text}`); return; }
  dozleSfx.advance();
  garoMount(`<div class="dz-toast" style="--mc:${DOZLE_MEMBERS[key].color}"><span class="dz-toast-icon">${dozleArt(key, "face")}</span><div><b>${esc(title)}</b><span>${esc(text)}</span></div></div>`, 4200);
}
function dozleXp(amount){
  if (garoReducedMotion?.()) return;
  dozleSfx.xp();
  const orbs = Array.from({length: Math.min(14, 4 + amount)}, (_, i) => `<i style="--x:${(i * 37) % 80 + 10}%;--d:${(i % 7) * .07}s"></i>`).join("");
  garoMount(`<div class="dz-xp-orbs">${orbs}</div>`, 1800);
}
function dozleClear(title, sub){
  garoAnnounce?.(`${title} ${sub}`);
  if (garoReducedMotion?.()) { flash(`${title} ${sub}`); return; }
  dozleSfx.clear();
  const oshi = dozleOshi();
  const blocks = Array.from({length: 36}, (_, i) => `<i style="--x:${(i * 29) % 100}%;--d:${(i % 9) * .1}s;--c:${DOZLE_MEMBERS[DOZLE_ORDER[i % 5]].color}"></i>`).join("");
  garoMount(`<div class="dz-clear"><div class="dz-clear-blocks">${blocks}</div><div class="dz-clear-card">${dozleMemberCard(oshi, {big: true, tilt: -4})}</div><div class="dz-clear-title">${dozlePixelText(title)}</div><div class="dz-clear-sub">${esc(sub)}</div></div>`, 4400);
}

function dozleHandleEvent(type, detail = {}){
  if (!dozleMode()) return;
  if (type === "check") {
    const c = countShift(detail.shift), label = detail.shift === "early" ? "早番" : "遅番", left = c.total - c.done;
    if (!left) { dozleClear("RTA CLEAR!", `${label}チェック 完走！ おつかれさまでした`); return; }
    if (left === 1) { dozleToast("ラストスパート", `${label}チェック あと1件`, "qnly"); return; }
    dozleSfx.pop(); return;
  }
  if (type === "todo") {
    if (!pendingTodos().length) { dozleClear("ALL CLEAR!", "未完了のTODOがゼロになりました"); return; }
    const helpers = ["qnly", "dozle", "bonjour", "oraf", "men"], key = Math.random() < .5 ? dozleOshi() : helpers[Math.floor(Math.random() * helpers.length)];
    dozleToast("進捗を達成しました！", String(detail.todo?.text || "TODO 完了").slice(0, 40), key);
    return;
  }
  if (type === "todo-add") { dozleSfx.pop(); return; }
  if (type === "record") {
    const author = detail.record?.author;
    const count = (state.records || []).filter(r => r.author === author).length;
    dozleXp(3);
    const before = dozleLevel(count - 1).level, after = dozleLevel(count).level;
    if (after > before) setTimeout(() => dozleToast("レベルアップ！", `${author || ""} Lv.${after} になりました`), 900);
    return;
  }
  if (type === "daily") { dozleToast("今日もおつかれさま！", "日次更新が完了しました", "dozle"); return; }
  if (type === "merge") { const s = detail.summary || {}; if (s.recordsAdded) dozleToast("仲間が合流！", `${s.from || "仲間"}の記録 +${s.recordsAdded}`, "oraf"); }
}

// ---------- Growth: one block per record ----------
const DZ_BLOCKS = [
  {max: 500, name: "土", top: "#5dab3a", side: "#8a5a34", dot: "#6d4526"},
  {max: 800, name: "石", top: "#9a9a9a", side: "#7d7d7d", dot: "#686868"},
  {max: 1100, name: "鉄", top: "#dcdcdc", side: "#c2c2c2", dot: "#d8af93"},
  {max: 1500, name: "金", top: "#fbe45b", side: "#f0c21e", dot: "#fff7b0"},
  {max: Infinity, name: "ダイヤ", top: "#7ff1e8", side: "#3fd0c6", dot: "#e6fffd"}
];
function dozleBlockSvg(record){
  const balls = recordBalls(record), b = DZ_BLOCKS.find(x => balls <= x.max);
  const dots = [[2, 3], [6, 5], [9, 2], [4, 8], [8, 9]].map(([x, y]) => `<rect x="${x}" y="${y + 1}" width="2" height="1" fill="${b.dot}"/>`).join("");
  return `<svg viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true"><rect width="12" height="12" fill="${b.side}"/><rect width="12" height="3" fill="${b.top}"/>${dots}<rect width="12" height="12" fill="none" stroke="#00000055" stroke-width=".5"/><title>${esc(b.name)}ブロック</title></svg>`;
}

// ---------- Hooks ----------
function dozleApplyTheme(theme){
  document.body.classList.toggle("dz-on", theme === "dozle");
  if (theme === "dozle") document.documentElement.style.setProperty("--oshi", DOZLE_MEMBERS[dozleOshi()].color);
  else document.documentElement.style.removeProperty("--oshi");
}
function dozleSettingsView(){
  const oshi = dozleOshi();
  return `<div class="garo-settings dz-settings"><strong>推しメン</strong><div class="dz-oshi-options" role="group" aria-label="推しメン">${DOZLE_ORDER.map(key => `<button type="button" class="dz-oshi ${oshi === key ? "active" : ""}" style="--mc:${DOZLE_MEMBERS[key].color}" data-action="set-dozle-oshi" data-oshi="${key}" aria-pressed="${oshi === key}">${dozleArt(key, "face")}<span>${esc(DOZLE_MEMBERS[key].name)}</span></button>`).join("")}</div><div class="settings-data-actions"><button type="button" class="secondary" data-action="toggle-garo-sound">${typeof garoSoundOn === "function" && garoSoundOn() ? "効果音：オン" : "効果音：オフ"}</button><button type="button" class="secondary" data-action="dozle-demo">演出を試す</button></div><small class="note">推しメンはホームの大きなカード・レベル表示・アクセントカラーに使います。</small>${dozleImageManager()}</div>`;
}
document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]"); if (!button || !state) return;
  if (button.dataset.action === "set-dozle-oshi") {
    const key = button.dataset.oshi; if (!DOZLE_MEMBERS[key] || key === dozleOshi()) return;
    await saveSettingsChange(() => { state.settings.dozleOshi = key; }, `推しメンを${DOZLE_MEMBERS[key].name}にしました`);
  }
  if (button.dataset.action === "dz-pick-image") {
    const [member, kind] = String(button.dataset.key).split(":");
    if (!DOZLE_MEMBERS[member] || !DZ_IMAGE_KINDS[kind]) return;
    dozlePendingImage = `${member}:${kind}`;
    $("#dz-image-input")?.click();
  }
  if (button.dataset.action === "dz-remove-image") {
    const key = String(button.dataset.key);
    if (!DZ_IMAGES[key] || !confirm("この画像を削除して、ドット絵に戻しますか？")) return;
    try { await dozleSaveImage(key, null); flash("画像を削除しました"); } catch (error) { flash(error.message); }
  }
  if (button.dataset.action === "dozle-demo" && dozleMode()) {
    dozleToast("進捗を達成しました！", "演出テスト");
    setTimeout(() => dozleXp(5), 1200);
    setTimeout(() => dozleClear("RTA CLEAR!", "演出テスト"), 2200);
  }
});
