#!/usr/bin/env python3
"""CI-6 secret scan over the SOURCE tree.

Scans the repository source for secret-shaped content and fails on any hit. The pattern set is
deliberately conservative and deterministic so it does not false-positive on the invented fixture
and tracker content or on authored prose: a private-key header, a cloud access-key id, a provider
token, a connection string that embeds a password, and a secret-named assignment whose value looks
real (not a placeholder, an environment reference or an example).

Findings carry the file and line and the rule name only, never the matched secret bytes.

Skips __pycache__, .git, dist, node_modules and the whole .paqad tree (its ledger holds content
hashes that are not secrets). Standard library only (Python 3.9+). No network. Read-only.

CLI:
  check_secrets.py [--root <repo-root>]

stdout: {"ok", "findings"}. Exit 0 clean, 1 on any finding (fails loudly, never a silent pass).
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

EXCLUDED_DIRS = {"__pycache__", ".git", "dist", "node_modules", ".paqad"}
BINARY_SUFFIXES = (".pyc", ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".ico", ".woff",
                   ".woff2", ".ttf", ".eot", ".mp4", ".mov")

PRIVATE_KEY = re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")
AWS_ACCESS_KEY = re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")
GITHUB_TOKEN = re.compile(r"\bgh[pousr]_[0-9A-Za-z]{36,}\b")
SLACK_TOKEN = re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}\b")
GOOGLE_API_KEY = re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")
CONNECTION_STRING = re.compile(
    r"\b(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|amqp|redis)://[^\s:@/]+:[^\s:@/]{3,}@"
)
SECRET_ASSIGN = re.compile(
    r"(?i)\b(password|passwd|secret|secret[_-]?key|api[_-]?key|access[_-]?token|"
    r"auth[_-]?token|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*(['\"])([^'\"]{8,})\2"
)

PLACEHOLDER_TOKENS = (
    "example", "changeme", "change-me", "placeholder", "your", "xxx", "redacted", "dummy",
    "fake", "sample", "none", "null", "todo", "replace", "insert", "value", "secret",
    "password", "token", "env", "os.environ", "process.env", "getenv", "vault",
)


def _looks_real(value):
    """Return True when an assignment value looks like a real secret, not a placeholder."""
    lowered = value.lower()
    if "${" in value or "{{" in value or value.startswith("<") or value.startswith("$"):
        return False
    for token in PLACEHOLDER_TOKENS:
        if token in lowered:
            return False
    if len(set(value)) < 5:
        return False
    has_letter = any(c.isalpha() for c in value)
    has_other = any(c.isdigit() or not c.isalnum() for c in value)
    return has_letter and has_other and len(value) >= 12


def scan_text(text, path_label):
    """Return the list of secret findings in text, labelled by path:line and rule name."""
    findings = []
    for number, line in enumerate(text.splitlines(), 1):
        where = "{0}:{1}".format(path_label, number)
        if PRIVATE_KEY.search(line):
            findings.append("{0}: private key header".format(where))
        if AWS_ACCESS_KEY.search(line):
            findings.append("{0}: cloud access key id".format(where))
        if GITHUB_TOKEN.search(line):
            findings.append("{0}: provider access token".format(where))
        if SLACK_TOKEN.search(line):
            findings.append("{0}: provider access token".format(where))
        if GOOGLE_API_KEY.search(line):
            findings.append("{0}: cloud api key".format(where))
        if CONNECTION_STRING.search(line):
            findings.append("{0}: connection string with embedded password".format(where))
        match = SECRET_ASSIGN.search(line)
        if match and _looks_real(match.group(3)):
            findings.append("{0}: secret-named assignment with a real value".format(where))
    return findings


def scan_tree(root):
    """Return the list of secret findings across the scanned source tree under root."""
    findings = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in EXCLUDED_DIRS)
        for name in sorted(filenames):
            if name.endswith(BINARY_SUFFIXES):
                continue
            full = os.path.join(dirpath, name)
            try:
                with open(full, "r", encoding="utf-8", errors="ignore") as handle:
                    text = handle.read()
            except OSError:
                continue
            label = os.path.relpath(full, root).replace(os.sep, "/")
            findings.extend(scan_text(text, label))
    return findings


def main(argv=None):
    parser = argparse.ArgumentParser(description="CI-6 secret scan over the source tree.")
    parser.add_argument("--root", default=REPO_ROOT)
    args = parser.parse_args(argv)

    findings = scan_tree(args.root)
    print(json.dumps({"ok": not findings, "findings": findings}, indent=2, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
