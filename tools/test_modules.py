import tempfile
import unittest
from pathlib import Path

from materialize_modules import MODULES, REQUIRED, materialize, owns


class ModulesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def put(self, rel, content="new"):
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def enable(self):
        self.put("modules/.enabled")
        for app, required in REQUIRED.items():
            for path in required:
                self.put(f"modules/{app}/{path}")

    def test_legacy_is_noop(self):
        file = self.put("dawnstore.py", "old")
        self.assertFalse(materialize(self.root))
        self.assertEqual(file.read_text(), "old")

    def test_missing_checkout_leaves_runtime_untouched(self):
        self.put("modules/.enabled")
        file = self.put("dawnstore.py", "old")
        with self.assertRaises(RuntimeError):
            materialize(self.root)
        self.assertEqual(file.read_text(), "old")

    def test_copy_and_remove_stale(self):
        self.enable()
        stale = self.put("public/js/apps/kana-old.js", "old")
        core = self.put("public/js/core/audio.js", "core")
        data = self.put("data/kana_progress.db", "data")
        asset = self.put("public/vendor/openjtalk-v1/test", "asset")
        self.assertTrue(materialize(self.root))
        self.assertEqual((self.root / "dawnstore.py").read_text(), "new")
        self.assertFalse(stale.exists())
        self.assertEqual(core.read_text(), "core")
        self.assertEqual(data.read_text(), "data")
        self.assertEqual(asset.read_text(), "asset")
        self.assertTrue(materialize(self.root))

    def test_path_ownership(self):
        self.assertTrue(owns("public/js/apps/kana-strokes.json", MODULES["kana.os"]))
        self.assertFalse(owns("public/js/core/audio.js", MODULES["dawn.os"]))
        self.assertFalse(owns("public/dungeon-old.html", MODULES["clown-dungeon.os"]))


if __name__ == "__main__":
    unittest.main()
