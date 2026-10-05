#!/usr/bin/env python3
"""Rank the modules in an onboarded registry against an idea or a question.

Reads the modules registry Markdown (docs/instructions/registries/modules.md) plus a query and
returns the candidate modules ranked by how much the query overlaps each module's name, plain
name, layer and features. The ranking is deterministic: a stable sort by descending score with
ties broken by the module's order in the registry, so the same registry and query always
produce the same list.

Standard library only. No network. Read-only: it writes nothing.

CLI:
  find_related.py --registry <modules.md> --query "<idea or question>"

stdout: a JSON list of {"module", "plain_name", "score", "matched_terms"}. Exit 0 on success,
1 when the registry is missing or unreadable.
"""

import argparse
import json
import re
import sys
from pathlib import Path

MIN_TERM = 3


def tokens(value):
    """Lowercase alphanumeric tokens, dropping anything shorter than MIN_TERM."""
    out = []
    for raw in re.split(r"[^0-9a-zA-Z]+", value.lower()):
        if len(raw) >= MIN_TERM:
            out.append(raw)
    return out


def parse_registry(markdown):
    """Return the module rows from the registry Markdown table, in registry order.

    A row is a dict {module, plain_name, layer, features, terms}. Only the pipe table rows that
    carry a real module are returned; the header row and the separator row are skipped.
    """
    rows = []
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) < 4:
            continue
        module = cells[0]
        if not module or module.lower() == "module":
            continue
        if set(module) <= set("-: "):
            continue
        plain_name = cells[1]
        layer = cells[2]
        features = cells[3]
        term_set = set()
        for field in (module, plain_name, layer, features):
            term_set.update(tokens(field))
        rows.append({
            "module": module,
            "plain_name": plain_name,
            "layer": layer,
            "features": features,
            "terms": term_set,
        })
    return rows


def term_matches(query_term, module_term):
    """True when the two terms overlap, allowing a substring match either way."""
    return query_term == module_term or query_term in module_term or module_term in query_term


def rank(rows, query):
    """Return the candidate modules with a positive score, ranked deterministically."""
    query_terms = []
    for term in tokens(query):
        if term not in query_terms:
            query_terms.append(term)
    ranked = []
    for index, row in enumerate(rows):
        matched = []
        for query_term in query_terms:
            if any(term_matches(query_term, module_term) for module_term in row["terms"]):
                matched.append(query_term)
        if matched:
            ranked.append({
                "module": row["module"],
                "plain_name": row["plain_name"],
                "score": len(matched),
                "matched_terms": matched,
                "_index": index,
            })
    ranked.sort(key=lambda item: (-item["score"], item["_index"]))
    for item in ranked:
        del item["_index"]
    return ranked


def main(argv=None):
    parser = argparse.ArgumentParser(description="Rank onboarded modules against a query.")
    parser.add_argument("--registry", required=True, type=Path)
    parser.add_argument("--query", required=True)
    args = parser.parse_args(argv)
    try:
        markdown = args.registry.read_text(encoding="utf-8")
    except OSError as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        return 1
    rows = parse_registry(markdown)
    print(json.dumps(rank(rows, args.query), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
