"""Shared helpers for the product-discovery scripts.

Standard library only. No network, no writes outside the caller-given path. This module has no
side effects on import and defines no command line interface; it is imported by record.py,
check_record.py, check_prose.py, check_ticket_set.py and plan_posting.py.

Ported from the 0.2.0 common.py for its pure logic only. The 0.2.0 file locks, data_root,
PLUGIN_DATA, atomic fsync writer and history helpers are NOT ported (PLG-5).
"""

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


def digest(value):
    """Return the sha256 hex of the canonical JSON of value.

    Canonical JSON is json.dumps with sort_keys true, ensure_ascii false,
    separators (",", ":") and allow_nan false, so two values that are equal
    as data always produce the same digest regardless of key order. Basis of
    REC-7 (the record ticket digest) and PUB-2 (the approval binding).
    """
    canonical = json.dumps(value, sort_keys=True, ensure_ascii=False,
                           separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def load(path):
    """Return the parsed JSON of the file at path, read as UTF-8 text."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def now():
    """Return the current UTC time as an ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


def text(value):
    """True when value is a non-empty, non-whitespace string."""
    return isinstance(value, str) and bool(value.strip())


def issue(code, path, message):
    """Return a single structured finding."""
    return {"code": code, "path": path, "message": message}


def result(errors):
    """Print the structured result and return the process exit code.

    Prints {"ok": not errors, "issues": errors} on stdout and returns 1 when
    there is any error, otherwise 0.
    """
    print(json.dumps({"ok": not errors, "issues": errors},
                     indent=2, ensure_ascii=False))
    return 1 if errors else 0
