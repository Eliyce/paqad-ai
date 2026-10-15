"""The Claude directory listing icon.

The directory reads .claude-plugin/icon.png in the plugin folder: a square PNG or JPEG, 512 to 2048 px
on each side, under 2 MB. The build copies publish/claude/icon.png there, into the Claude branch only,
and adds no icon key to any manifest.
"""

import json
import os
import shutil
import struct
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO_ROOT, "build"))

import build  # noqa: E402

PLUGIN_NAME = "paqad-product-discovery"
SOURCE = os.path.join(REPO_ROOT, "publish", "claude", "icon.png")
ICON_REL = ("plugins", PLUGIN_NAME, ".claude-plugin", "icon.png")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def png_size(data):
    """Width and height from a PNG's IHDR chunk."""
    return struct.unpack(">II", data[16:24])


class ListingIconTest(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.dist = os.path.join(cls.tmp, "dist")
        build.build(REPO_ROOT, cls.dist)
        cls.claude = os.path.join(cls.dist, "hosts", "claude")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_source_icon_meets_the_directory_rules(self):
        data = read_bytes(SOURCE)
        self.assertTrue(data.startswith(PNG_SIGNATURE), "icon must be a PNG")
        width, height = png_size(data)
        self.assertEqual(width, height, "icon must be square")
        self.assertTrue(512 <= width <= 2048, "icon side {0} px out of range".format(width))
        self.assertLess(len(data), 2 * 1024 * 1024)

    def test_claude_plugin_folder_carries_the_icon(self):
        self.assertEqual(read_bytes(os.path.join(self.claude, *ICON_REL)), read_bytes(SOURCE))

    def test_other_branches_and_the_combined_root_carry_no_icon(self):
        for root in (self.dist, os.path.join(self.dist, "hosts", "chatgpt"),
                     os.path.join(self.dist, "hosts", "codex")):
            for dirpath, _, names in os.walk(root):
                if dirpath.startswith(self.claude):
                    continue
                self.assertNotIn("icon.png", names, dirpath)

    def test_no_manifest_gains_an_icon_key(self):
        for dirpath, _, names in os.walk(self.dist):
            for name in names:
                if name in ("plugin.json", "marketplace.json"):
                    with open(os.path.join(dirpath, name), encoding="utf-8") as handle:
                        self.assertNotIn("icon", json.load(handle), os.path.join(dirpath, name))


if __name__ == "__main__":
    unittest.main()
