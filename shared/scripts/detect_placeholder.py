#!/usr/bin/env python3
"""Mark each section of a document as real or template (GRD-4).

Splits a document into sections by Markdown heading and checks each section against the
onboarding template markers from both paqad template generations. A section that still holds a
marker phrase is template; a section with no marker is real. A document that holds a real
section and a template section reports both, so the plugin can report which parts of an area
are grounded and which are still a blank template without presenting the template text as fact.

Standard library only. No network. Read-only: it writes nothing.

CLI:
  detect_placeholder.py --path <doc.md> [--markers <template-markers.md>]

The markers file defaults to shared/references/template-markers.md next to this script. stdout:
{"sections": [{"heading", "status", "markers_hit"}]}. Exit 0.
"""

import argparse
import json
import re
import sys
from pathlib import Path

DEFAULT_MARKERS = Path(__file__).resolve().parents[1] / "references" / "template-markers.md"
HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def load_markers(path):
    """Return the marker phrases from the markers file, one phrase per non-heading line."""
    markers = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("- "):
            stripped = stripped[2:].strip()
        markers.append(stripped)
    return markers


def split_sections(document):
    """Return a list of (heading, body_text) pairs split by Markdown heading.

    Any content before the first heading is returned as a leading section with an empty heading
    so a template marker there is still detected.
    """
    sections = []
    heading = ""
    body = []
    started = False
    for line in document.splitlines():
        match = HEADING.match(line)
        if match:
            if started or body:
                sections.append((heading, "\n".join(body)))
            heading = match.group(2).strip()
            body = []
            started = True
        else:
            body.append(line)
    if started or body:
        sections.append((heading, "\n".join(body)))
    return sections


def classify(sections, markers):
    """Return the per-section status, checking the heading and the body for each marker."""
    results = []
    for heading, body in sections:
        haystack = heading + "\n" + body
        hit = [marker for marker in markers if marker in haystack]
        results.append({
            "heading": heading,
            "status": "template" if hit else "real",
            "markers_hit": hit,
        })
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description="Mark document sections real or template.")
    parser.add_argument("--path", required=True, type=Path)
    parser.add_argument("--markers", type=Path, default=DEFAULT_MARKERS)
    args = parser.parse_args(argv)
    document = args.path.read_text(encoding="utf-8")
    markers = load_markers(args.markers)
    sections = classify(split_sections(document), markers)
    print(json.dumps({"sections": sections}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
