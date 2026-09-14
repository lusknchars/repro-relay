import importlib.util
import json
import pathlib
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("context_worker", pathlib.Path(__file__).with_name("worker.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        self.git("init", "-q")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "Fixture")

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], check=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout

    def test_only_tracked_instruction_files_are_read(self):
        (self.root / "AGENTS.md").write_text("Tracked instructions.")
        (self.root / "CLAUDE.md").write_text("Untracked instructions.")
        (self.root / ".env").write_text("PRIVATE=not-an-instruction")
        self.git("add", "AGENTS.md", ".env")
        scan = worker.snapshot(self.root)
        self.assertEqual(scan["files"], [{"path": "AGENTS.md", "content": "Tracked instructions."}])
        (self.root / "AGENTS.md").write_text("Changed instructions.")
        self.assertNotEqual(worker.snapshot(self.root), scan)
        (self.root / "AGENTS.md").unlink()
        self.assertEqual(worker.snapshot(self.root)["files"], [])

    def test_symlinks_and_large_files_fail_closed(self):
        (self.root / "private.txt").write_text("Never follow this link.")
        (self.root / "AGENTS.md").symlink_to(self.root / "private.txt")
        self.git("add", "AGENTS.md")
        with self.assertRaises(ValueError):
            worker.snapshot(self.root)
        (self.root / "AGENTS.md").unlink()
        (self.root / "AGENTS.md").write_text("x" * 65537)
        self.git("add", "AGENTS.md")
        with self.assertRaises(ValueError):
            worker.snapshot(self.root)

    def test_bundle_preserves_unicode_paths_and_exact_line_endings(self):
        text = "Keep café evidence.\r\n\r\n" * 100
        files = [{"path": "AGENTS.md", "content": text}, {"path": "nested/AGENTS.md", "content": text}]
        result = worker.bundle(files)
        self.assertEqual(len(result["bodies"]), 1)
        self.assertEqual([{ "path": s["path"], "content": result["bodies"][s["body"]] } for s in result["sources"]], files)
        self.assertLess(len(json.dumps(result)), len(json.dumps(files)))

    def test_external_urls_and_redirects_are_rejected(self):
        for url in ["https://example.com/api/v1", "http://localhost.evil/api/v1", "http://user@localhost/api/v1", "http://localhost/api/v1?token=x"]:
            with self.assertRaises(ValueError):
                worker.API(url)
        self.assertIsNone(worker.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com"))

    def test_pause_avoids_repository_and_claim_access(self):
        class API:
            def request(self, path, data=None):
                if path != "/autonomy":
                    raise AssertionError("Paused harness dispatched work")
                return {"control": {"paused": True}}
        self.assertEqual(worker.cycle(API(), "/does-not-exist"), "paused")

    def test_change_before_result_withholds_publication(self):
        (self.root / "AGENTS.md").write_text("Original")
        self.git("add", "AGENTS.md")
        root = self.root
        calls = []
        class API:
            def request(self, path, data=None):
                calls.append(path)
                if path == "/autonomy":
                    return {"control": {"paused": False}}
                if path == "/autonomy/scans":
                    self.scan = data
                    return {"id": "SCAN-fixture"}
                if path == "/autonomy/claims":
                    (root / "AGENTS.md").write_text("Changed")
                    return {"job": {"id": "PROP-fixture", "schema_version": 1, "kind": "lossless_context_pack_v1", "scan_id": "SCAN-fixture", "files": self.scan["files"]}}
                raise AssertionError("Stale result published")
        self.assertIn("withheld", worker.cycle(API(), root))
        self.assertEqual(calls.count("/autonomy/scans"), 2)


if __name__ == "__main__":
    unittest.main()

class ArchitectureTests(unittest.TestCase):
    setUp = HarnessTests.setUp
    git = HarnessTests.git
    def test_manifest_inventory_reads_metadata_without_scripts_or_secrets(self):
        (self.root / 'Cargo.toml').write_text('[package]\nname="fixture"\n[dependencies]\ncore={path="core"}\naxum="0.8"\n')
        (self.root / 'core').mkdir()
        (self.root / 'core/Cargo.toml').write_text('[package]\nname="core"\n')
        (self.root / 'package.json').write_text(json.dumps({'name':'frontend','dependencies':{'react':'19'},'scripts':{'install':'touch SHOULD_NOT_EXIST'}}))
        (self.root / '.env').write_text('SECRET=do-not-upload')
        self.git('add','Cargo.toml','core/Cargo.toml','package.json','.env')
        result=worker.architecture_snapshot(self.root)
        self.assertEqual(len(result['nodes']),3)
        self.assertNotIn('do-not-upload',json.dumps(result))
        self.assertNotIn('SHOULD_NOT_EXIST',json.dumps(result))
        self.assertFalse((self.root/'SHOULD_NOT_EXIST').exists())
        self.assertEqual(result['nodes'][0]['dependencies'],['core/Cargo.toml'])
        (self.root/'package.json').unlink()
        (self.root/'package.json').symlink_to(self.root/'.env')
        with self.assertRaises(ValueError): worker.architecture_snapshot(self.root)
