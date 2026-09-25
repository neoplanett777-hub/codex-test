"""Checks that run without a window: data validation, share file naming and the single-page build."""
import json
import re
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
try:
    import webview  # noqa: F401
except ImportError:  # CI on Linux or a machine without pywebview: the host logic does not need it.
    sys.modules["webview"] = types.SimpleNamespace(OPEN_DIALOG=10, SAVE_DIALOG=20, FOLDER_DIALOG=30, settings={})

import desktop  # noqa: E402


class DesktopTests(unittest.TestCase):
    def test_empty_state_is_valid(self):
        state = desktop.empty_state()
        self.assertIs(desktop.validate_state(state), state)

    def test_master_data_adds_stores_and_keywords_once(self):
        state = desktop.empty_state()
        self.assertTrue(desktop.ensure_master_data(state))
        self.assertEqual(len(state["hpStores"]), len(desktop.DEFAULT_HP_STORES))
        self.assertFalse(desktop.ensure_master_data(state))

    def test_tombstones_must_be_a_list(self):
        state = desktop.empty_state()
        state["tombstones"] = {"todo": "x"}
        with self.assertRaises(ValueError):
            desktop.validate_state(state)
        state["tombstones"] = [{"kind": "todo", "id": "x", "at": "2026-09-25T10:00:00"}]
        desktop.validate_state(state)

    def test_share_file_name_strips_unsafe_characters(self):
        name = desktop.share_file_name('岸/:*?"<>|')
        self.assertTrue(name.startswith("リーダーTODO_共有_岸_"))
        self.assertTrue(name.endswith(".json"))
        self.assertRegex(desktop.share_file_name(None), r"^リーダーTODO_共有_\d{4}-\d{2}-\d{2}_\d{4}\.json$")

    def test_links_are_checked(self):
        self.assertEqual(desktop.validate_link_target("https://example.com/a"), "web")
        for bad in ("http://localhost/", "http://192.168.0.1/", "\\\\server\\share\\a.xlsx", "C:\\a.exe"):
            with self.assertRaises(ValueError):
                desktop.validate_link_target(bad)

    def test_assembled_page_inlines_every_file_and_pins_scripts(self):
        page = desktop.assembled_html()
        self.assertIn("Content-Security-Policy", page)
        self.assertNotIn('src="/', page)
        self.assertNotIn('href="/', page)
        for marker in ("function garoHandleEvent", "function mergeStates", "function dollboxStacks", "html[data-theme=\"garo\"]", "function dozleHandleEvent", "html[data-theme=\"dozle\"]"):
            self.assertIn(marker, page)
        script = re.search(r"<script>(.*)</script>\n</body>", page, re.S).group(1)
        self.assertIn(desktop.script_hash(script), page)

    def test_theme_images_are_checked_and_kept_apart(self):
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            desktop.DATA_DIR = Path(folder)
            desktop.THEME_IMAGES_FILE = Path(folder) / "theme_images.json"
            api = desktop.DesktopApi()
            desktop.GUARD_READY.set()
            png = "data:image/png;base64,iVBORw0KGgo="
            self.assertEqual(api.save_theme_image("qnly:body", png), {"ok": True})
            self.assertEqual(api.get_theme_images(), {"qnly:body": png})
            api.save_theme_image("qnly:body", None)
            self.assertEqual(api.get_theme_images(), {})
            for key, data in (("other:body", png), ("qnly:hair", png), ("qnly:face", "data:text/html;base64,PGI+"), ("qnly:face", "javascript:alert(1)")):
                with self.assertRaises(ValueError):
                    api.save_theme_image(key, data)
            self.assertFalse((Path(folder) / "state.json").exists())

    def test_portable_mode_moves_data_next_to_the_exe_and_back(self):
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            pc, app = Path(root) / "pc", Path(root) / "usb"
            app.mkdir()
            saved = (desktop.PC_DATA_DIR, desktop.PORTABLE_DIR, desktop.APP_FOLDER, desktop.running_from_temp)
            desktop.running_from_temp = lambda: False
            desktop.PC_DATA_DIR, desktop.PORTABLE_DIR, desktop.APP_FOLDER = pc, app / "LeaderTODO_data", app
            try:
                desktop.use_data_dir(pc)
                desktop.GUARD_READY.set()
                api = desktop.DesktopApi()
                state = api.get_state()
                state["settings"]["uiTheme"] = "garo"
                api.save_state(state)
                info = api.enable_portable()
                self.assertTrue(info["portable"])
                self.assertEqual(api.get_state()["settings"]["uiTheme"], "garo")
                state = api.get_state(); state["settings"]["uiTheme"] = "dozle"; api.save_state(state)
                self.assertEqual(json.loads((app / "LeaderTODO_data" / "state.json").read_text(encoding="utf-8"))["settings"]["uiTheme"], "dozle")
                info = api.disable_portable()
                self.assertFalse(info["portable"])
                self.assertFalse((app / "LeaderTODO_data").exists())
                self.assertEqual(api.get_state()["settings"]["uiTheme"], "dozle")
            finally:
                desktop.PC_DATA_DIR, desktop.PORTABLE_DIR, desktop.APP_FOLDER, desktop.running_from_temp = saved

    def test_portable_mode_is_refused_when_opened_inside_a_zip(self):
        import tempfile
        saved = (desktop.APP_FOLDER, desktop.PORTABLE_DIR)
        with tempfile.TemporaryDirectory() as root:
            desktop.APP_FOLDER = Path(root) / "abc_LeaderTODO-exe.zip"
            desktop.PORTABLE_DIR = desktop.APP_FOLDER / "LeaderTODO_data"
            try:
                self.assertTrue(desktop.running_from_temp())
                desktop.GUARD_READY.set()
                desktop.use_data_dir(Path(root) / "pc")
                with self.assertRaises(ValueError):
                    desktop.DesktopApi().enable_portable()
                self.assertFalse(desktop.PORTABLE_DIR.exists())
            finally:
                desktop.APP_FOLDER, desktop.PORTABLE_DIR = saved

    def test_report_file_name_matches_the_page(self):
        report = (ROOT / "web" / "report.js").read_text(encoding="utf-8")
        self.assertIn("リーダー記録_週次_", report)
        self.assertIn("リーダー記録_月次_", report)


if __name__ == "__main__":
    unittest.main()
