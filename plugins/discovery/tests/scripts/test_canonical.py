#!/usr/bin/env python3
"""Unit tests for shared/scripts/canonical.py.

Standard library only (Python 3.9+). No network. Writes only under a temporary folder.
Covers digest determinism and key-order independence (sort_keys), and the load, text, issue
and result helpers.
"""

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
SHARED_SCRIPTS = os.path.join(REPO_ROOT, "shared", "scripts")
if SHARED_SCRIPTS not in sys.path:
    sys.path.insert(0, SHARED_SCRIPTS)

import canonical  # noqa: E402


class DigestTest(unittest.TestCase):
    def test_digest_is_deterministic(self):
        value = {"b": 1, "a": [1, 2, 3], "c": {"x": True}}
        self.assertEqual(canonical.digest(value), canonical.digest(value))

    def test_digest_is_key_order_independent(self):
        first = {"a": 1, "b": 2, "nested": {"p": 1, "q": 2}}
        second = {"b": 2, "nested": {"q": 2, "p": 1}, "a": 1}
        self.assertEqual(canonical.digest(first), canonical.digest(second))

    def test_digest_matches_reference_formula(self):
        import hashlib
        value = {"run_id": "DR-20261005-7K2Q", "revision": 3}
        expected = hashlib.sha256(json.dumps(
            value, sort_keys=True, ensure_ascii=False,
            separators=(",", ":"), allow_nan=False).encode("utf-8")).hexdigest()
        self.assertEqual(canonical.digest(value), expected)

    def test_digest_changes_with_content(self):
        self.assertNotEqual(canonical.digest({"a": 1}), canonical.digest({"a": 2}))

    def test_digest_rejects_nan(self):
        with self.assertRaises(ValueError):
            canonical.digest({"n": float("nan")})


class LoadTest(unittest.TestCase):
    def test_load_reads_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "value.json")
            payload = {"hello": "wörld", "n": 2}
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False)
            self.assertEqual(canonical.load(path), payload)


class HelperTest(unittest.TestCase):
    def test_text_truth(self):
        self.assertTrue(canonical.text("goal"))
        self.assertTrue(canonical.text("  non blank  "))

    def test_text_rejects_empty_and_non_strings(self):
        for value in ("", "   ", None, 0, [], {}, 5):
            self.assertFalse(canonical.text(value))

    def test_issue_shape(self):
        self.assertEqual(
            canonical.issue("CODE", "a.b", "msg"),
            {"code": "CODE", "path": "a.b", "message": "msg"})

    def test_now_is_iso_utc(self):
        from datetime import datetime
        value = canonical.now()
        self.assertTrue(value.endswith("+00:00") or value.endswith("Z"))
        datetime.fromisoformat(value.replace("Z", "+00:00"))


class ResultTest(unittest.TestCase):
    def _run(self, errors):
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            code = canonical.result(errors)
        return code, json.loads(buffer.getvalue())

    def test_clean_result(self):
        code, payload = self._run([])
        self.assertEqual(code, 0)
        self.assertEqual(payload, {"ok": True, "issues": []})

    def test_failing_result(self):
        finding = canonical.issue("X", "p", "m")
        code, payload = self._run([finding])
        self.assertEqual(code, 1)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["issues"], [finding])


if __name__ == "__main__":
    unittest.main()
