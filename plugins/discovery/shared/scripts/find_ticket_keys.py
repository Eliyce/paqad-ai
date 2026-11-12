#!/usr/bin/env python3
"""Count Jira key prefixes and GitHub refs in branch names and commit subjects read from stdin.

Run with --help to print the usage.
"""

import argparse
import json
import re
import sys

KEY_PATTERN = re.compile(r"\b([A-Z][A-Z0-9]{1,9})-(\d+)\b", re.IGNORECASE)
GITHUB_REF = re.compile(r"(?<![\w&])#\d+\b")
IGNORED_PREFIXES = ("UTF", "ISO", "SHA", "HTTP", "HTTPS", "RFC", "CVE", "V")
MAX_EXAMPLES = 3
CLEAR_FLOOR = 3
CLEAR_FACTOR = 2


def scan(lines):
    counts = {}
    newest = {}
    examples = {}
    github_refs = 0
    lines_read = 0
    for index, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue
        lines_read += 1
        github_refs += len(GITHUB_REF.findall(line))
        for match in KEY_PATTERN.finditer(line):
            prefix = match.group(1).upper()
            if prefix in IGNORED_PREFIXES:
                continue
            key = "{0}-{1}".format(prefix, match.group(2))
            counts[prefix] = counts.get(prefix, 0) + 1
            newest.setdefault(prefix, index)
            seen = examples.setdefault(prefix, [])
            if key not in seen and len(seen) < MAX_EXAMPLES:
                seen.append(key)
    ordered = sorted(counts, key=lambda prefix: (-counts[prefix], newest[prefix]))
    return {
        "lines_read": lines_read,
        "jira_prefixes": [
            {"prefix": prefix, "count": counts[prefix], "examples": examples[prefix]}
            for prefix in ordered
        ],
        "github_refs": github_refs,
    }


def verdict(result):
    prefixes = result["jira_prefixes"]
    if not prefixes:
        return "github" if result["github_refs"] > 0 else "ask"
    top = prefixes[0]["count"]
    if top < CLEAR_FLOOR:
        return "ask"
    following = prefixes[1]["count"] if len(prefixes) > 1 else 0
    return "clear" if top >= CLEAR_FACTOR * following else "several"


def main(argv=None, stdin=None):
    parser = argparse.ArgumentParser(
        description="Count Jira ticket key prefixes and GitHub refs in branch names and commit "
        "subjects read from stdin, one per line, newest first. Reads only stdin and prints JSON."
    )
    parser.parse_args(argv)
    result = scan((stdin or sys.stdin).read().splitlines())
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
