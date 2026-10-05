#!/usr/bin/env python3
"""Suggest a size from comparable finished work, and guard a size-field write (EST-2 to EST-6).

Two subcommands:

  suggest  Reads the target ticket, a pool of finished tickets (each with a key, link and size)
           and the team scale, and returns the two to five closest comparables, a suggested size
           or range, the drivers behind it, and a confidence of low, medium or high. The result is
           ALWAYS labelled "suggested size" and is never a date (EST-5). No field is written.
           When the target area docs are template text the confidence is lowered one notch and the
           reason says so (AC-36). When fewer than two comparables exist the tool reports it and
           invents no size (EST-2/3, AC-35 honesty).

  set      Given the current value of a size field, refuses to write when the field already holds a
           value unless --replace is given (EST-6, AC-37); otherwise the write is allowed.

Comparable scoring: each pool ticket is scored against the target by the Jaccard overlap of their
token sets (summary words plus labels, lowercased, stopwords dropped). The pool is ranked by that
score; comparables are the up-to-five tickets with a positive score. The suggested size is the most
common size among the comparables; when they disagree the suggestion is reported as a range over the
scale (lowest to highest comparable size) and the confidence drops.

Template-docs heuristic (kept local so size-work needs no extra shared import): the area docs are
template when they are empty or contain any known placeholder marker (TODO, TBD, lorem ipsum,
"fill in", "describe the", "<...>", "coming soon").

Standard library only (Python 3.9+). No network. Read-only: writes nothing outside stdout.

CLI:
  compare_sizes.py suggest --target <target.json> --pool <finished.json> --scale <scale.json>
                           [--area-docs <docs.md>]
  compare_sizes.py set --field-value <current> [--replace]

suggest stdout: {"ok", "suggestion": {"size","range","drivers":[...],"confidence",
                 "confidence_reason","comparables":[{"key","link","size"}],"label":"suggested size"}}
set stdout:     {"ok", "write": bool, "reason"}
Exit 0 on a clean suggestion or an allowed write; 1 on a refused overwrite or an error.
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

import canonical

LABEL = "suggested size"
CONFIDENCE_ORDER = ("low", "medium", "high")

STOPWORDS = frozenset((
    "a", "an", "the", "and", "or", "for", "to", "of", "in", "on", "with", "as", "is", "be",
    "this", "that", "it", "we", "add", "update", "fix", "make", "support", "enable",
))
WORD = re.compile(r"[A-Za-z0-9]+")

TEMPLATE_MARKERS = (
    "todo", "tbd", "lorem ipsum", "fill in", "describe the", "coming soon",
    "placeholder", "<describe", "<add", "xxx",
)


def tokens(*parts):
    """Return the lowercased, stopword-free token set of the given text parts and label lists."""
    bag = set()
    for part in parts:
        if isinstance(part, (list, tuple)):
            for item in part:
                bag.update(WORD.findall(str(item).lower()))
        else:
            bag.update(WORD.findall(str(part or "").lower()))
    return {token for token in bag if token not in STOPWORDS}


def jaccard(left, right):
    if not left or not right:
        return 0.0
    inter = len(left & right)
    union = len(left | right)
    return inter / union if union else 0.0


def is_template_docs(text):
    """True when the area docs are empty or hold any known placeholder marker (AC-36)."""
    if text is None:
        return False  # no docs supplied is not the same as template docs
    lowered = text.lower()
    if not lowered.strip():
        return True
    return any(marker in lowered for marker in TEMPLATE_MARKERS)


def find_comparables(target, pool, limit=5):
    """Return up to `limit` pool tickets with a positive similarity, highest score first."""
    target_tokens = tokens(target.get("summary"), target.get("description"),
                            target.get("labels", []))
    scored = []
    for cand in pool:
        cand_tokens = tokens(cand.get("summary"), cand.get("description"),
                             cand.get("labels", []))
        score = jaccard(target_tokens, cand_tokens)
        if score > 0:
            scored.append((score, cand))
    # Deterministic order: score desc, then key asc.
    scored.sort(key=lambda pair: (-pair[0], str(pair[1].get("key", ""))))
    return [cand for _, cand in scored[:limit]]


def _lower(confidence):
    index = CONFIDENCE_ORDER.index(confidence)
    return CONFIDENCE_ORDER[max(0, index - 1)]


def suggest(target, pool, scale, area_docs_text=None):
    """Return the suggestion dict for the suggest subcommand."""
    scale_list = scale.get("scale") if isinstance(scale, dict) else scale
    scale_list = list(scale_list or [])
    comparables = find_comparables(target, pool)
    comp_rows = [{"key": c.get("key"), "link": c.get("link"), "size": c.get("size")}
                 for c in comparables]

    drivers = []
    target_tokens = tokens(target.get("summary"), target.get("labels", []))
    for cand in comparables:
        shared = sorted(target_tokens & tokens(cand.get("summary"), cand.get("labels", [])))
        if shared:
            drivers.append("Shares {0} with {1}".format(", ".join(shared), cand.get("key")))

    if len(comp_rows) < 2:
        return {
            "size": None,
            "range": None,
            "drivers": drivers,
            "confidence": "low",
            "confidence_reason": "Fewer than two comparable finished tickets were found, so no "
                                 "size is suggested rather than inventing one.",
            "comparables": comp_rows,
            "label": LABEL,
        }

    sizes = [row["size"] for row in comp_rows if row["size"] is not None]
    counts = Counter(sizes)
    most_common, top_count = counts.most_common(1)[0]
    agree = top_count == len(sizes)

    size = most_common
    size_range = None
    confidence = "high" if (agree and len(comp_rows) >= 3) else "medium"
    reason_parts = ["Based on {0} comparable finished tickets".format(len(comp_rows))]
    if not agree:
        # Comparables disagree: report a range across the scale and lower confidence.
        in_scale = [s for s in sizes if s in scale_list]
        if in_scale:
            ordered = sorted(in_scale, key=scale_list.index)
            size_range = [ordered[0], ordered[-1]]
        else:
            size_range = [min(sizes), max(sizes)]
        confidence = _lower(confidence)
        reason_parts.append("the comparables disagree, so a range is given")

    if is_template_docs(area_docs_text):
        confidence = _lower(confidence)
        reason_parts.append("the target area docs are template text, so confidence is lowered")

    return {
        "size": size,
        "range": size_range,
        "drivers": drivers,
        "confidence": confidence,
        "confidence_reason": "; ".join(reason_parts) + ".",
        "comparables": comp_rows,
        "label": LABEL,
    }


def decide_write(current_value, replace):
    """Return (write_allowed, reason) for the set subcommand (EST-6, AC-37)."""
    has_value = canonical.text(current_value) if isinstance(current_value, str) \
        else current_value not in (None, "", [], {})
    if has_value and not replace:
        return False, ("The size field already holds a value; refusing to overwrite it unless "
                       "replace is explicitly asked.")
    if has_value and replace:
        return True, "The size field holds a value and replace was asked, so the write is allowed."
    return True, "The size field is empty, so the write is allowed."


def main(argv=None):
    parser = argparse.ArgumentParser(description="Suggest a size or guard a size-field write.")
    sub = parser.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("suggest", help="Suggest a size from comparables.")
    sp.add_argument("--target", required=True, type=Path)
    sp.add_argument("--pool", required=True, type=Path)
    sp.add_argument("--scale", required=True, type=Path)
    sp.add_argument("--area-docs", type=Path, default=None)

    st = sub.add_parser("set", help="Guard a size-field write.")
    st.add_argument("--field-value", default="")
    st.add_argument("--replace", action="store_true")

    args = parser.parse_args(argv)

    if args.command == "suggest":
        target = canonical.load(args.target)
        pool = canonical.load(args.pool)
        scale = canonical.load(args.scale)
        area_docs = args.area_docs.read_text(encoding="utf-8") if args.area_docs else None
        suggestion = suggest(target, pool, scale, area_docs)
        print(json.dumps({"ok": True, "suggestion": suggestion},
                         indent=2, ensure_ascii=False))
        return 0

    write, reason = decide_write(args.field_value, args.replace)
    print(json.dumps({"ok": write, "write": write, "reason": reason},
                     indent=2, ensure_ascii=False))
    return 0 if write else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
