"""Shared helpers for the product-discovery scripts.

Standard library only. No network, no writes outside the caller-given path. This module has no
side effects on import and defines no command line interface; it is imported by record.py,
check_record.py, check_prose.py, check_ticket_set.py and plan_posting.py.

Ported from the 0.2.0 common.py for its pure logic only. The 0.2.0 file locks, data_root,
PLUGIN_DATA, atomic fsync writer and history helpers are NOT ported (PLG-5).
"""

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

INTERNAL_REF = re.compile(r"^E[0-9]+(?:-T[0-9]+)?$")
TRACKER_REF = re.compile(r"^[A-Z][A-Z0-9]+-[0-9]+$")


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


def is_external_ref(ref):
    """True when ref names an external tracker issue (e.g. PROJ-123), not an internal set ref.

    An internal ref is an epic (E1) or ticket (E1-T1) ref minted inside the set. A ref that is not
    internal but matches a tracker issue key shape (an uppercase project key, a hyphen and a number)
    is an external dependency on an issue that already lives in the tracker. Both check_ticket_set
    and plan_posting resolve a dependency through this one helper (RULE-04a1) so an external tracker
    ref is treated as a valid dependency, never a dangling one and never silently skipped.
    """
    if not isinstance(ref, str):
        return False
    if INTERNAL_REF.match(ref):
        return False
    return bool(TRACKER_REF.match(ref))


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
