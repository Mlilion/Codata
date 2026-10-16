"""Offline regression tests for runtime license retention."""

import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile


spec = importlib.util.spec_from_file_location(
    "download_node", Path(__file__).with_name("download_node.py")
)
download_node = importlib.util.module_from_spec(spec)
spec.loader.exec_module(download_node)


class RuntimeLicenseTests(unittest.TestCase):
    def test_windows_retains_distribution_and_npm_licenses(self):
        archive = io.BytesIO()
        entries = {
            "LICENSE": b"Node.js license",
            "node.exe": b"binary",
            "node_modules/npm/LICENSE": b"npm license",
            "README.md": b"not required",
        }
        with zipfile.ZipFile(archive, "w") as handle:
            for name, content in entries.items():
                handle.writestr(f"node-test/{name}", content)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            download_node._extract_windows(archive.getvalue(), root)
            self.assertEqual((root / "LICENSE").read_bytes(), entries["LICENSE"])
            self.assertTrue((root / "node.exe").is_file())
            self.assertTrue((root / "node_modules/npm/LICENSE").is_file())
            self.assertFalse((root / "README.md").exists())

    def test_unix_retains_distribution_and_npm_licenses(self):
        archive = io.BytesIO()
        entries = {
            "LICENSE": b"Node.js license",
            "bin/node": b"binary",
            "lib/node_modules/npm/LICENSE": b"npm license",
        }
        with tarfile.open(fileobj=archive, mode="w:gz") as handle:
            for name, content in entries.items():
                info = tarfile.TarInfo(f"node-test/{name}")
                info.size = len(content)
                handle.addfile(info, io.BytesIO(content))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            download_node._extract_unix(archive.getvalue(), root)
            self.assertEqual((root / "LICENSE").read_bytes(), entries["LICENSE"])
            self.assertTrue((root / "bin/node").is_file())
            self.assertTrue((root / "lib/node_modules/npm/LICENSE").is_file())


if __name__ == "__main__":
    unittest.main()
