"""Offline, dedicated-window host for the リーダー TODO HTML interface.

Rebuilt from the 最新TODO EX desktop host: the same storage, backup, link and HP-check rules,
with the data kept in its own folder so it never touches the 主任 TODO data on the same PC.
"""
from __future__ import annotations

import copy
import base64
import hashlib
import ipaddress
import json
import os
import re
import shutil
import socket
import sys
import tempfile
import threading
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path, PureWindowsPath
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

import webview


APP_NAME = "リーダーTODO"
BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
WEB = BASE / "web"
# Data lives in the user's AppData by default. When a "LeaderTODO_data" folder sits next to the exe
# (portable mode), everything is kept there instead, so the exe and its data travel together on a USB stick.
PC_DATA_DIR = Path(os.environ.get("APPDATA", Path.home())) / APP_NAME
APP_FOLDER = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
PORTABLE_DIR = APP_FOLDER / "LeaderTODO_data"
DATA_FILES = ("state.json", "state.previous.json", "theme_images.json")


def use_data_dir(folder: Path) -> None:
    """Point every data file at one folder; the functions below read these names at call time."""
    global DATA_DIR, STATE_FILE, BACKUP_FILE, BACKUP_DIR, THEME_IMAGES_FILE
    DATA_DIR = folder
    STATE_FILE = folder / "state.json"
    BACKUP_FILE = folder / "state.previous.json"
    BACKUP_DIR = folder / "backups"
    # Pictures the user adds for the theme are kept apart from state.json, so they are never part of a shared JSON export.
    THEME_IMAGES_FILE = folder / "theme_images.json"


use_data_dir(PORTABLE_DIR if PORTABLE_DIR.is_dir() else PC_DATA_DIR)
THEME_IMAGE_MEMBERS = {"qnly", "dozle", "bonjour", "oraf", "men"}
THEME_IMAGE_KINDS = {"body", "face"}
MAX_THEME_IMAGE_CHARS = 4_000_000
THEME_IMAGE_PATTERN = re.compile(r"data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}")
DAILY_BACKUPS_KEPT = 30
EVENT_BACKUPS_KEPT = 20
BACKUP_REASONS = {"before-excel-import", "before-json-import"}
SOURCE_BOOK = Path("D:\\最新TODO\u3000EX.xlsm")
MAX_STATE_BYTES = 8_000_000
MAX_EXCEL_BYTES = 20_000_000
LOCK = threading.RLock()
GUARD_READY = threading.Event()

HP_URLS = {
    "hp-7": "https://p-town.dmm.com/shops/ibaraki/2575",
    "hp-8": "https://p-town.dmm.com/shops/ibaraki/2565",
    "hp-9": "https://p-town.dmm.com/shops/ibaraki/12218",
    "hp-10": "https://p-town.dmm.com/shops/ibaraki/12759",
    "hp-11": "https://p-town.dmm.com/shops/ibaraki/2559",
    "hp-12": "https://p-town.dmm.com/shops/ibaraki/2566",
    "hp-13": "https://www.p-world.co.jp/ibaraki/alive-toukaiminami.htm",
    "hp-14": "https://p-town.dmm.com/shops/ibaraki/12727",
}
DEFAULT_HP_STORES = [
    ("hp-7", "水戸本店"), ("hp-8", "MGM"), ("hp-9", "赤〇"), ("hp-10", "けやき〇"),
    ("hp-11", "河和田 東"), ("hp-12", "河和田 南"), ("hp-13", "アライブ"), ("hp-14", "キコーナ"),
]
DEFAULT_THEME_KEYWORDS = [
    {"theme": "確認・チェック", "keywords": ["確認", "チェック", "見落", "気が付", "気づ", "漏れ"]},
    {"theme": "新装・入替", "keywords": ["新装", "入替", "入れ替", "最新台", "移動台", "店休"]},
    {"theme": "データ・設定", "keywords": ["データ", "設定", "配線", "断線", "表記", "スロット"]},
    {"theme": "告知・POP", "keywords": ["告知", "ポップ", "POP", "案内", "掲示", "販促"]},
    {"theme": "共有・連携", "keywords": ["共有", "チームス", "Teams", "連携", "統一", "相談"]},
    {"theme": "部下・育成", "keywords": ["部下", "成長", "育成", "教育", "気にかけ", "視野"]},
    {"theme": "シフト・人員", "keywords": ["シフト", "人員", "出勤", "休憩", "早番", "遅番"]},
    {"theme": "引継ぎ・記録", "keywords": ["引継", "引き継", "記載", "記録", "TODO", "ＴＯＤＯ"]},
    {"theme": "設備・環境", "keywords": ["外灯", "LED", "清掃", "設備", "店内", "環境"]},
    {"theme": "SNS・情報発信", "keywords": ["LINE", "ＬＩＮＥ", "SNS", "投稿", "曜日", "日付"]},
]
# Relative document links carried over from the original workbook. Only these may be opened
# against the base folder; anything else must be an absolute drive path or a public web page.
LOCAL_LINK_HASHES = {
    "030d2dbab2c477af3b8c8778feaf05dccc5d8a63fe4fd6d9f76b57de6409ea31",
    "046272752d3c6808e5b3f2fbebd2d05c8663569bc8a2777df19983c7daf774a5",
    "190688e87ea8a9340aeb4456f88b262ff4ef84cd5e74fbf73c845c2c6760760e",
    "2dd22dbcb848fb07e5b1534fee87b562e6b4339ce0721c4c215d02c300175efe",
    "41c1f932603b8c30ae82ad8056ed3feb6bd8e8e44505e085c1f6d77900c6c223",
    "538b36f9ed6c5036218f60a3c25a77796a0deedaa557bcde7d61b1a82c5bf975",
    "54b64e7f89282b2d4b9053c68f9edce1051df7959dcafd910aab3afcb9056d21",
    "5d6b7beb913c809a63b519da71fcd8713bef5e0339aceea0f9b201f6f6d458cc",
    "799abb2776399424db6bf58662cae587033eab3f1984144f3f5210dbc4a1a2cc",
    "7e22fde1f97376f7694a95bf35681b977b7ebcbb90c378b664022ee8a4c14a3c",
    "928db6b382dc59b5a0b9c571b5bb752464d47ea073956d5f76c3fb5e1cadf5be",
    "af28a536e2b21a8b82c4306d9cf487fc93af17f56e65ec2a053c870e041210af",
    "b9b5840c200aca89985c6f7223d12e68e0f3315e15fface6c5ae8cb70415896d",
    "d9977fa44b9c263c53c9d8bd2ce3fa6a0f37ca6c7d48685d2b19b0ae2e1928eb",
    "f4eac9df007b6c388f8081f66addaefc47f20bfc076248527e3566a992df14c4",
}
LEGACY_PARENT_LEVELS = 3
LOCAL_DOCUMENT_EXTENSIONS = {".xlsx", ".xlsm", ".xls", ".pdf", ".docx", ".doc", ".txt", ".csv"}
IMAGE_EXT = re.compile(r"\.(?:jpe?g|png|gif|webp)$", re.IGNORECASE)
IMAGE_SKIP = ("/global-nav/", "/icons/", "/machines/", "/carousel-common/", "/footer",
              "/thumbnail/no_image", "loading.gif", "map_code_long", "/sns/", "to-pagetop")


def timestamp() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def validate_state(value: object) -> dict:
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("保存データの形式が異なります")
    for name in ("todos", "records", "hpStores", "referenceLinks"):
        if not isinstance(value.get(name), list):
            raise ValueError(f"{name} の形式が異なります")
    if not isinstance(value.get("shiftSections"), dict) or not isinstance(value.get("settings"), dict):
        raise ValueError("設定の形式が異なります")
    for name in ("todoArchive", "checkHistory", "recordTrash", "tombstones"):
        if value.get(name) is not None and not isinstance(value.get(name), list):
            raise ValueError(f"{name} の形式が異なります")
    seen_link_ids = set()
    for link in value["referenceLinks"]:
        if not isinstance(link, dict):
            raise ValueError("関連リンクの形式が異なります")
        link_id, label, target = link.get("id"), link.get("label"), link.get("url")
        department = link.get("department", "")
        if not isinstance(link_id, str) or not link_id or len(link_id) > 120 or link_id in seen_link_ids:
            raise ValueError("関連リンクのIDが不正です")
        seen_link_ids.add(link_id)
        if not isinstance(label, str) or not label.strip() or len(label) > 120 or any(ord(c) < 32 for c in label):
            raise ValueError("関連リンクの名前が不正です")
        if not isinstance(department, str) or len(department) > 60 or any(ord(c) < 32 for c in department):
            raise ValueError("部門名が不正です")
        validate_link_target(target)
    base_dir = value["settings"].get("linkBaseDir")
    if base_dir not in (None, ""):
        validate_local_base_dir(base_dir)
    if len(json.dumps(value, ensure_ascii=False).encode("utf-8")) > MAX_STATE_BYTES:
        raise ValueError("データが大きすぎます")
    return value


def empty_state() -> dict:
    return {
        "schemaVersion": 1,
        "source": {},
        "shiftSections": {"early": [], "late": []},
        "todos": [],
        "records": [],
        "hpStores": [],
        "referenceLinks": [],
        "owners": [],
        "settings": {"graph": {}, "calendarEntries": [], "reflectionDrafts": [], "hpCheck": {}},
    }


def ensure_master_data(state: dict) -> bool:
    """Add missing HP stores and topic keywords without touching anything already saved."""
    changed = False
    known_ids = {s.get("id") for s in state["hpStores"]}
    for store_id, name in DEFAULT_HP_STORES:
        if store_id not in known_ids:
            state["hpStores"].append({
                "id": store_id, "sourceRow": int(store_id[3:]), "name": name, "status": None,
                "checkedAt": None, "imageCount": None, "change": None, "detail": None,
                "url": HP_URLS[store_id], "imageUrlBaseline": [],
            })
            changed = True
    graph = state["settings"].get("graph")
    if not isinstance(graph, dict):
        graph = state["settings"]["graph"] = {}
        changed = True
    if "themeKeywords" not in graph:
        graph["themeKeywords"] = copy.deepcopy(DEFAULT_THEME_KEYWORDS)
        changed = True
    return changed


def atomic_save(value: dict, *, backup: bool = True) -> None:
    validate_state(value)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="state-", suffix=".tmp", dir=DATA_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as out:
            json.dump(value, out, ensure_ascii=False, indent=2)
            out.flush()
            os.fsync(out.fileno())
        if backup and STATE_FILE.is_file():
            shutil.copy2(STATE_FILE, BACKUP_FILE)
            keep_daily_backup()
        os.replace(tmp, STATE_FILE)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def prune_backups(pattern: str, keep: int) -> None:
    for old in sorted(BACKUP_DIR.glob(pattern), reverse=True)[keep:]:
        old.unlink(missing_ok=True)


def keep_daily_backup() -> None:
    """Keep the first state seen each day, so one bad save cannot overwrite every copy."""
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        daily = BACKUP_DIR / f"state-{datetime.now():%Y-%m-%d}.json"
        if not daily.exists():
            shutil.copy2(STATE_FILE, daily)
            prune_backups("state-????-??-??.json", DAILY_BACKUPS_KEPT)
    except OSError:
        return


def backup_event(reason: str) -> Path:
    if reason not in BACKUP_REASONS:
        raise ValueError("バックアップの種類が不正です")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"event-{datetime.now():%Y-%m-%d_%H%M%S}-{reason}.json"
    shutil.copy2(STATE_FILE, target)
    prune_backups("event-*.json", EVENT_BACKUPS_KEPT)
    return target


def load_state() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not STATE_FILE.exists():
        atomic_save(empty_state(), backup=False)
    try:
        state = validate_state(json.loads(STATE_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError, RecursionError):
        if not BACKUP_FILE.is_file():
            raise
        recovered = validate_state(json.loads(BACKUP_FILE.read_text(encoding="utf-8")))
        ensure_master_data(recovered)
        atomic_save(recovered, backup=False)
        return recovered
    if ensure_master_data(state):
        atomic_save(state)
    return state


def canonical_image_url(value: str | None) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    url = value.strip().replace("\\/", "/").split("#", 1)[0].split("?", 1)[0].lower()
    if url.startswith(("data:", "javascript:")) or any(part in url for part in IMAGE_SKIP):
        return None
    return url if IMAGE_EXT.search(url) else None


class ImageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        candidates = [values.get(key) for key in ("src", "data-src", "data-original")]
        if tag.lower() == "meta" and (values.get("property") or values.get("name") or "").lower() in {"og:image", "twitter:image"}:
            candidates.append(values.get("content"))
        for raw in candidates:
            image = canonical_image_url(raw)
            if image:
                self.images.add(image)


def validate_hp_url(url: str, expected_host: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != expected_host or parsed.port not in (None, 443) or parsed.username or parsed.password:
        raise ValueError("登録された店舗サイト以外へは接続できません")
    if not parsed.path.startswith("/") or "\\" in url:
        raise ValueError("URL の形式が不正です")
    addresses = socket.getaddrinfo(expected_host, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError("接続先のネットワークアドレスが不正です")


class PinnedRedirects(HTTPRedirectHandler):
    def __init__(self, host: str):
        self.host = host

    def redirect_request(self, request, fp, code, msg, headers, newurl):
        validate_hp_url(newurl, self.host)
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def check_store(store: dict, source_url: str) -> dict:
    updated = copy.deepcopy(store)
    host = urlsplit(source_url).hostname
    try:
        validate_hp_url(source_url, host)
        opener = build_opener(ProxyHandler({}), PinnedRedirects(host))
        request = Request(source_url, headers={"User-Agent": "Mozilla/5.0 LeaderTodo/1.0"})
        with opener.open(request, timeout=15) as response:
            content_type = response.headers.get("Content-Type", "")
            if "text/html" not in content_type.lower():
                raise ValueError("HTML を取得できませんでした")
            raw = response.read(2_000_001)
            if len(raw) > 2_000_000:
                raise ValueError("ページが大きすぎます")
            body = raw.decode(response.headers.get_content_charset() or "utf-8", "replace")
        parser = ImageParser()
        parser.feed(body)
        images = sorted(parser.images)
        if not images:
            raise ValueError("画像 URL を取得できませんでした")
        previous = {image for image in (canonical_image_url(x) for x in store.get("imageUrlBaseline") or []) if image}
        current = set(images)
        updated.update({
            "imageUrlBaseline": images,
            "imageCount": len(images),
            "checkedAt": timestamp(),
            "status": "変更あり" if previous and previous != current else "変更なし" if previous else "初回取得",
            "change": len(previous.symmetric_difference(current)) if previous else 0,
            "detail": f"追加 {len(current - previous)} / 削除 {len(previous - current)}" if previous else "基準を保存しました",
            "checkError": None,
        })
    except (HTTPError, URLError, TimeoutError, ValueError, UnicodeError, OSError, LookupError) as error:
        updated.update({"checkError": str(error), "status": "確認失敗", "checkedAt": timestamp()})
    return updated


def validate_link_target(target: str) -> str:
    if not isinstance(target, str) or len(target) > 2048 or any(ord(c) < 32 for c in target):
        raise ValueError("リンクの形式が不正です")
    if target.startswith(("\\", "/")):
        raise ValueError("ネットワークパスは開けません。ドライブ（例: Z:）として割り当てたうえで、そのドライブから選んでください")
    if PureWindowsPath(target).is_absolute():
        if not re.match(r"^[A-Za-z]:[\\/]", target) or PureWindowsPath(target).suffix.lower() not in LOCAL_DOCUMENT_EXTENSIONS:
            raise ValueError("この種類のファイルは開けません")
        return "file"
    parsed = urlsplit(target)
    if parsed.scheme in {"http", "https"}:
        host = parsed.hostname.rstrip(".").lower() if parsed.hostname else None
        if not host or parsed.username or parsed.password or "\\" in target or parsed.port not in (None, 80, 443):
            raise ValueError("Web リンクの形式が不正です")
        if host == "localhost" or host.endswith(".local"):
            raise ValueError("ローカルネットワークのリンクは開けません")
        try:
            if not ipaddress.ip_address(host).is_global:
                raise ValueError("ローカルネットワークのリンクは開けません")
        except ValueError as error:
            if "ローカルネットワーク" in str(error):
                raise
        return "web"
    if parsed.scheme or PureWindowsPath(target).is_absolute():
        raise ValueError("この種類のリンクは開けません")
    if hashlib.sha256(target.encode("utf-8")).hexdigest() not in LOCAL_LINK_HASHES:
        raise ValueError("登録済みのローカル参照先だけを開けます")
    return "legacy"


def mapped_drive_for(unc: str) -> str | None:
    """Return the drive-letter form of a UNC path when that share is mapped (for example Z:)."""
    try:
        import ctypes
        from ctypes import wintypes
        mask = ctypes.windll.kernel32.GetLogicalDrives()
        get_connection = ctypes.windll.mpr.WNetGetConnectionW
        get_connection.argtypes = [wintypes.LPCWSTR, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    except (AttributeError, OSError):
        return None
    folded = unc.rstrip("\\").lower()
    for index in range(26):
        if not mask & (1 << index):
            continue
        drive = f"{chr(65 + index)}:"
        buffer, size = ctypes.create_unicode_buffer(1024), wintypes.DWORD(1024)
        if get_connection(drive, buffer, ctypes.byref(size)) != 0 or not buffer.value:
            continue
        remote = buffer.value.rstrip("\\").lower()
        if folded == remote or folded.startswith(remote + "\\"):
            return drive + unc.rstrip("\\")[len(remote):] + ("\\" if folded == remote else "")
    return None


def local_path(value: str) -> Path:
    """Normalise a chosen path without resolve(): resolve() turns a mapped network drive (Z:) into
    \\\\server\\share and a subst drive into its real folder, which then fails every drive check."""
    path = os.path.normpath(os.path.abspath(value))
    if path.startswith("\\\\"):
        mapped = mapped_drive_for(path)
        if not mapped:
            raise ValueError("ネットワーク上のフォルダーは、エクスプローラーでドライブ（例: Z:）として割り当ててから、そのドライブから選んでください")
        path = mapped
    return Path(path)


def validate_local_base_dir(value: str) -> Path:
    if not isinstance(value, str) or len(value) > 1024 or any(ord(c) < 32 for c in value):
        raise ValueError("基準フォルダーの形式が不正です")
    parsed = PureWindowsPath(value)
    if not parsed.is_absolute() or not re.fullmatch(r"[A-Za-z]:", parsed.drive):
        raise ValueError("ドライブ文字（例: C: や Z:）のあるフォルダーを選んでください")
    return Path(value)


def safe_link(target: str, base_dir: str | None = None) -> str:
    kind = validate_link_target(target)
    if kind == "web":
        return target
    if kind == "file":
        resolved = local_path(target)
        if not resolved.is_file() or resolved.suffix.lower() not in LOCAL_DOCUMENT_EXTENSIONS:
            raise ValueError("参照先が見つかりません")
        return str(resolved)
    base = validate_local_base_dir(base_dir) if base_dir else SOURCE_BOOK.parent
    if not base.is_dir():
        raise ValueError(f"基準フォルダーが見つかりません（{base}）。関連リンク画面の「フォルダーを選ぶ」で元のExcelがあるフォルダーを指定してください")
    resolved = resolve_legacy(target, base)
    if resolved is None:
        raise ValueError(f"参照先が見つかりません（基準フォルダー: {base}）。関連リンク画面の「フォルダーを選ぶ」で元のExcelがあるフォルダーを指定してください")
    if not resolved.is_file() or resolved.suffix.lower() not in LOCAL_DOCUMENT_EXTENSIONS:
        raise ValueError("この種類のファイルは開けません")
    return str(resolved)


def resolve_legacy(target: str, base: Path) -> Path | None:
    """Excel stores hyperlinks relative to the workbook, sometimes percent-encoded and written from a
    different folder level, so try the base folder, a few of its parents, then its direct subfolders."""
    relative = unquote(target)
    folders = [base, *list(base.parents)[:LEGACY_PARENT_LEVELS]]
    try:
        folders += sorted(child for child in base.iterdir() if child.is_dir())
    except OSError:
        pass
    for folder in folders:
        resolved = Path(os.path.normpath(folder / relative))
        if resolved.drive.lower() == base.drive.lower() and resolved.exists():
            return resolved
    return None


def link_status(state: dict) -> dict:
    """Check the page's current links against a base folder; only registered targets are resolved."""
    base_dir = state["settings"].get("linkBaseDir")
    try:
        base = validate_local_base_dir(base_dir) if base_dir else SOURCE_BOOK.parent
    except ValueError:
        base = None
    seen, missing, total = set(), [], 0
    for link in state["referenceLinks"]:
        target = link.get("url") if isinstance(link, dict) else None
        if not isinstance(target, str) or target in seen:
            continue
        seen.add(target)
        try:
            kind = validate_link_target(target)
        except ValueError:
            continue
        if kind == "web":
            continue
        total += 1
        found = Path(target).is_file() if kind == "file" else bool(base and base.is_dir() and resolve_legacy(target, base))
        if not found:
            missing.append(link.get("label") or target)
    return {"base": str(base) if base else None, "total": total, "ok": total - len(missing), "missing": missing}


def validate_theme_image_key(key: object) -> str:
    member, _, kind = key.partition(":") if isinstance(key, str) else ("", "", "")
    if member not in THEME_IMAGE_MEMBERS or kind not in THEME_IMAGE_KINDS:
        raise ValueError("画像の登録先が正しくありません")
    return key


def validate_theme_image(data: object) -> str:
    if not isinstance(data, str) or len(data) > MAX_THEME_IMAGE_CHARS or not THEME_IMAGE_PATTERN.fullmatch(data):
        raise ValueError("PNG・JPEG・WebP の画像を選んでください（大きすぎる画像は登録できません）")
    return data


def load_theme_images() -> dict:
    try:
        value = json.loads(THEME_IMAGES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(value, dict):
        return {}
    images = {}
    for key, data in value.items():
        try:
            images[validate_theme_image_key(key)] = validate_theme_image(data)
        except ValueError:
            continue
    return images


def save_theme_images(images: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="images-", suffix=".tmp", dir=DATA_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as out:
            json.dump(images, out, ensure_ascii=False)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, THEME_IMAGES_FILE)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def copy_data(source: Path, target: Path) -> None:
    """Copy the saved data and backups; the WebView cache is left behind (it always stays on the PC)."""
    target.mkdir(parents=True, exist_ok=True)
    for name in DATA_FILES:
        if (source / name).is_file():
            shutil.copy2(source / name, target / name)
    if (source / "backups").is_dir():
        shutil.copytree(source / "backups", target / "backups", dirs_exist_ok=True)


def storage_info() -> dict:
    return {"portable": DATA_DIR == PORTABLE_DIR, "path": str(DATA_DIR), "portablePath": str(PORTABLE_DIR), "pcPath": str(PC_DATA_DIR)}


def share_file_name(user: object) -> str:
    """共有用JSONの既定のファイル名。使用者名はファイル名に使えない文字を除いて入れる。"""
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", user).strip()[:20] if isinstance(user, str) else ""
    return f"リーダーTODO_共有_{name + '_' if name else ''}{datetime.now():%Y-%m-%d_%H%M}.json"


class DesktopApi:
    def __init__(self):
        self._window = None
        self._report_font_b64 = None

    def get_state(self):
        self._guard()
        with LOCK:
            return load_state()

    def _guard(self):
        if not GUARD_READY.wait(10):
            raise RuntimeError("画面の安全設定を有効にできませんでした")

    def save_state(self, value):
        self._guard()
        with LOCK:
            atomic_save(validate_state(value))
        return {"ok": True, "savedAt": timestamp()}

    def check_hp(self, store_id):
        self._guard()
        if not isinstance(store_id, str) or store_id not in HP_URLS:
            raise ValueError("登録された店舗が見つかりません")
        with LOCK:
            state = load_state()
            matches = [s for s in state["hpStores"] if isinstance(s, dict) and s.get("id") == store_id]
            if len(matches) != 1:
                raise ValueError("店舗が見つかりません")
            store = copy.deepcopy(matches[0])
        checked = check_store(store, HP_URLS[store_id])
        with LOCK:
            state = load_state()
            current = [s for s in state["hpStores"] if isinstance(s, dict) and s.get("id") == store_id]
            if len(current) != 1 or current[0] != store:
                raise ValueError("確認中に店舗データが更新されました。もう一度確認してください")
            state["hpStores"] = [checked if isinstance(s, dict) and s.get("id") == store_id else s for s in state["hpStores"]]
            state["settings"].setdefault("hpCheck", {})["lastCheckedAt"] = checked["checkedAt"]
            atomic_save(state)
            return {"store": checked, "state": state}

    def open_link(self, target):
        self._guard()
        with LOCK:
            state = load_state()
        known = {item.get("url") for item in state["referenceLinks"] if isinstance(item, dict)}
        known.update(HP_URLS[item.get("id")] for item in state["hpStores"] if isinstance(item, dict) and item.get("id") in HP_URLS)
        if target not in known:
            raise ValueError("登録されたリンクが見つかりません")
        destination = safe_link(target, state["settings"].get("linkBaseDir"))
        os.startfile(destination)
        return {"ok": True}

    def get_link_status(self, request):
        self._guard()
        if not isinstance(request, dict) or not isinstance(request.get("links"), list) or len(request["links"]) > 2000:
            raise ValueError("リンクの形式が不正です")
        links = [{"label": str(item.get("label") or ""), "url": item.get("url")} for item in request["links"] if isinstance(item, dict)]
        return link_status({"referenceLinks": links, "settings": {"linkBaseDir": request.get("base") or None}})

    def validate_reference_target(self, target):
        self._guard()
        return {"ok": True, "kind": validate_link_target(target)}

    def choose_link_file(self):
        self._guard()
        selected = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=("Documents (*.xlsx;*.xlsm;*.xls;*.pdf;*.docx;*.doc;*.txt;*.csv)",),
        )
        if not selected:
            return {"ok": False, "cancelled": True}
        path = str(local_path(selected[0]))
        if validate_link_target(path) != "file" or not Path(path).is_file():
            raise ValueError("文書ファイルを選んでください")
        return {"ok": True, "path": path}

    def choose_link_base_dir(self):
        self._guard()
        selected = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if not selected:
            return {"ok": False, "cancelled": True}
        path = str(local_path(selected[0]))
        if not validate_local_base_dir(path).is_dir():
            raise ValueError("ローカルのフォルダーを選んでください")
        return {"ok": True, "path": path}

    def get_storage_info(self):
        self._guard()
        return storage_info()

    def enable_portable(self):
        """Copy this PC's data next to the exe and keep saving there from now on."""
        self._guard()
        with LOCK:
            if DATA_DIR == PORTABLE_DIR:
                return storage_info()
            load_state()
            try:
                PORTABLE_DIR.mkdir(parents=True, exist_ok=True)
                probe = PORTABLE_DIR / ".write-test"
                probe.write_text("ok", encoding="utf-8")
                probe.unlink()
                copy_data(DATA_DIR, PORTABLE_DIR)
            except OSError as error:
                raise ValueError(f"exe と同じフォルダーに保存できません（{APP_FOLDER}）。USBメモリなど書き込めるフォルダーに exe を置いてください") from error
            use_data_dir(PORTABLE_DIR)
            return storage_info()

    def disable_portable(self):
        """Bring the carried data back into this PC's AppData and stop using the folder next to the exe."""
        self._guard()
        with LOCK:
            if DATA_DIR != PORTABLE_DIR:
                return storage_info()
            load_state()
            if (PC_DATA_DIR / "state.json").is_file():
                (PC_DATA_DIR / "backups").mkdir(parents=True, exist_ok=True)
                shutil.copy2(PC_DATA_DIR / "state.json", PC_DATA_DIR / "backups" / f"event-{datetime.now():%Y-%m-%d_%H%M%S}-before-portable-return.json")
            copy_data(PORTABLE_DIR, PC_DATA_DIR)
            retired = PORTABLE_DIR.with_name(f"{PORTABLE_DIR.name}_old_{datetime.now():%Y%m%d_%H%M%S}")
            try:
                PORTABLE_DIR.rename(retired)
            except OSError as error:
                raise ValueError("持ち歩き用フォルダーの名前を変えられませんでした。ほかのアプリで開いていないか確認してください") from error
            use_data_dir(PC_DATA_DIR)
            return storage_info()

    def open_data_folder(self):
        self._guard()
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(str(DATA_DIR))
        return {"ok": True}

    def export_data(self, user=None):
        self._guard()
        selected = self._window.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=share_file_name(user),
            file_types=("JSON files (*.json)",),
        )
        if not selected:
            return {"ok": False, "cancelled": True}
        path = Path(selected if isinstance(selected, str) else selected[0])
        if path.suffix.lower() != ".json":
            path = path.with_suffix(".json")
        with LOCK:
            state = load_state()
        path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True, "path": str(path)}

    def save_report_pdf(self, request):
        """Save browser-generated PDF bytes without reading or changing app state."""
        self._guard()
        if not isinstance(request, dict):
            raise ValueError("PDFデータの形式が正しくありません")
        filename = request.get("filename")
        encoded = request.get("base64")
        count = request.get("count")
        if (not isinstance(filename, str)
                or not re.fullmatch(r"リーダー記録_(?:週次_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}|月次_\d{4}-\d{2})\.pdf", filename)
                or not isinstance(encoded, str) or len(encoded) > 40_000_000
                or type(count) is not int or count < 0):
            raise ValueError("PDFデータの内容が正しくありません")
        try:
            pdf_bytes = base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise ValueError("PDFデータを読み取れません") from exc
        if not pdf_bytes.startswith(b"%PDF-") or b"%%EOF" not in pdf_bytes[-1024:] or len(pdf_bytes) > 30_000_000:
            raise ValueError("有効なPDFデータではありません")
        selected = self._window.create_file_dialog(
            webview.SAVE_DIALOG, save_filename=filename, file_types=("PDF files (*.pdf)",),
        )
        if not selected:
            return {"ok": False, "cancelled": True}
        path = Path(selected if isinstance(selected, str) else selected[0])
        if path.suffix.lower() != ".pdf":
            path = path.with_suffix(".pdf")
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(prefix=".todo-report-", suffix=".tmp", dir=path.parent, delete=False) as stream:
                temp_path = Path(stream.name)
                stream.write(pdf_bytes)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp_path, path)
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()
        return {"ok": True, "path": str(path), "count": count}

    def get_vendor_script_chunk(self, name, index):
        """Hand the PDF libraries to the page on first use; the CSP already allows their exact hashes."""
        self._guard()
        if name not in VENDOR_SCRIPTS or type(index) is not int or index < 0 or index > 16:
            raise ValueError("PDF 作成部品の指定が正しくありません")
        text = vendor_script(name)
        chunk_size = 512_000
        start = index * chunk_size
        if start >= len(text):
            raise ValueError("PDF 作成部品の読み込み位置が範囲外です")
        end = min(start + chunk_size, len(text))
        return {"data": text[start:end], "more": end < len(text)}

    def get_report_font_chunk(self, index):
        """Return bounded chunks so NavigateToString and the JS bridge stay small."""
        self._guard()
        if type(index) is not int or index < 0 or index > 64:
            raise ValueError("フォントの読み込み位置が正しくありません")
        if self._report_font_b64 is None:
            font_path = WEB / "vendor" / "NotoSansJP-Regular.ttf"
            self._report_font_b64 = base64.b64encode(font_path.read_bytes()).decode("ascii")
        chunk_size = 512_000
        start = index * chunk_size
        end = min(start + chunk_size, len(self._report_font_b64))
        if start >= len(self._report_font_b64):
            raise ValueError("フォントの読み込み位置が範囲外です")
        return {"data": self._report_font_b64[start:end], "more": end < len(self._report_font_b64)}

    def backup_now(self, reason):
        self._guard()
        with LOCK:
            load_state()
            path = backup_event(reason)
        return {"ok": True, "path": str(path)}

    def choose_excel_file(self):
        """Return the chosen workbook's bytes; the page parses it and never writes to it."""
        self._guard()
        selected = self._window.create_file_dialog(
            webview.OPEN_DIALOG, file_types=("Excel (*.xlsm;*.xlsx)",),
        )
        if not selected:
            return {"ok": False, "cancelled": True}
        path = local_path(selected[0])
        if path.suffix.lower() not in {".xlsm", ".xlsx"} or not path.is_file():
            raise ValueError("Excelファイル（.xlsm / .xlsx）を選んでください")
        if path.stat().st_size > MAX_EXCEL_BYTES:
            raise ValueError("20MB以下のExcelファイルを選んでください")
        data = path.read_bytes()
        modified = datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
        return {
            "ok": True, "name": path.name, "path": str(path), "folder": str(path.parent),
            "modifiedAt": modified, "sha256": hashlib.sha256(data).hexdigest(),
            "base64": base64.b64encode(data).decode("ascii"),
        }

    def get_theme_images(self):
        self._guard()
        with LOCK:
            return load_theme_images()

    def save_theme_image(self, key, data=None):
        """Store or remove one picture; None removes it."""
        self._guard()
        key = validate_theme_image_key(key)
        with LOCK:
            images = load_theme_images()
            if data is None:
                images.pop(key, None)
            else:
                images[key] = validate_theme_image(data)
            save_theme_images(images)
        return {"ok": True}

    def import_data(self):
        self._guard()
        selected = self._window.create_file_dialog(webview.OPEN_DIALOG, file_types=("JSON files (*.json)",))
        if not selected:
            return {"ok": False, "cancelled": True}
        path = Path(selected[0])
        if path.stat().st_size > MAX_STATE_BYTES:
            raise ValueError("データが大きすぎます")
        value = validate_state(json.loads(path.read_text(encoding="utf-8")))
        return {"ok": True, "state": value}


NAVIGATE_LIMIT_BYTES = 1_572_864
VENDOR_SCRIPTS = {"pdf-lib": "vendor/pdf-lib.min.js", "fontkit": "vendor/fontkit.umd.min.js"}
PAGE_CSS = ("styles.css", "mobile.css", "themes.css", "links.css", "growth.css", "settings.css",
            "report.css", "dollbox.css", "garo.css", "dozle.css")
PAGE_JS = ("app.js", "growth.js", "report.js", "excel_import.js", "checklist_edit.js", "share.js", "garo.js", "dozle.js")


def vendor_script(name: str) -> str:
    return (WEB / VENDOR_SCRIPTS[name]).read_text(encoding="utf-8")


def script_hash(text: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode("ascii") + "'"


def check_page_size(page: str) -> int:
    size = len(page.encode("utf-8"))
    if size > NAVIGATE_LIMIT_BYTES * 0.9:
        raise RuntimeError(f"画面のHTMLが {size:,} バイトで、WebView2 の上限 {NAVIGATE_LIMIT_BYTES:,} バイトに近すぎます")
    return size


def assembled_html() -> str:
    """Inline every stylesheet and script into one page; the CSP only allows these exact scripts."""
    page = (WEB / "index.html").read_text(encoding="utf-8")
    css = "\n".join((WEB / name).read_text(encoding="utf-8") for name in PAGE_CSS)
    js = "\n".join((WEB / name).read_text(encoding="utf-8") for name in PAGE_JS)
    hashes = " ".join([script_hash(js), *(script_hash(vendor_script(name)) for name in VENDOR_SCRIPTS)])
    policy = (f"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src {hashes}; "
              "connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'")
    page = page.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="{policy}">')
    page = page.replace('<link rel="stylesheet" href="/styles.css">', f"<style>{css}</style>")
    for name in PAGE_CSS[1:]:
        page = page.replace(f'<link rel="stylesheet" href="/{name}">', "")
    for name in PAGE_JS:
        page = page.replace(f'<script defer src="/{name}"></script>', "")
    for path in VENDOR_SCRIPTS.values():
        page = page.replace(f'<script defer src="/{path}"></script>', "")
    page = page.replace("</body>", f"<script>{js}</script>\n</body>")
    check_page_size(page)
    return page


def install_navigation_guard(window):
    """Install guards on the WebView2 UI thread before untrusted state is rendered."""
    import clr  # noqa: F401  (pythonnet, loaded by pywebview on Windows)
    from System import Action

    control = window.native.webview
    if getattr(window, "_todo_guard_installed", False):
        return

    def install():
        core = control.CoreWebView2
        if core is None:
            raise RuntimeError("WebView2 の初期化が完了していません")

        def reject_navigation(sender, args):
            if str(args.Uri).lower() != "about:blank":
                args.Cancel = True

        def reject_popup(sender, args):
            args.Handled = True

        core.NavigationStarting += reject_navigation
        core.FrameNavigationStarting += reject_navigation
        core.NewWindowRequested += reject_popup
        window._todo_guard_handlers = (reject_navigation, reject_popup)
        window._todo_guard_installed = True
        GUARD_READY.set()

    control.Invoke(Action(install))


def main() -> None:
    with LOCK:
        load_state()
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = False
    webview.settings["ALLOW_DOWNLOADS"] = False
    api = DesktopApi()
    window = webview.create_window(
        "リーダー TODO",
        html=assembled_html(),
        js_api=api,
        width=1100,
        height=750,
        min_size=(800, 560),
        background_color="#f5f7fb",
    )
    api._window = window
    window.events.loaded += lambda: install_navigation_guard(window)
    webview.start(
        gui="edgechromium",
        http_server=False,
        private_mode=False,
        storage_path=str(PC_DATA_DIR / "webview"),
        icon=str(BASE / "icon.ico"),
    )


if __name__ == "__main__":
    main()
