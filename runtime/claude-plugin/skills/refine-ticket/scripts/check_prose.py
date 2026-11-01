#!/usr/bin/env python3
"""Check ticket prose: no dashes, no code words in scoped fields, no deny-list jargon.

Ports the 0.2.0 lint_prose discipline (skip fenced code blocks, blockquotes, inline-code spans
and URLs so quoted evidence is never rewritten) and adds the three ticket prose rules:

  TKT-1  no em dash (U+2014) or en dash (U+2013) used as a dash, anywhere in the text.
  TKT-2  no code words in the title, the Goal / What they need and why sections, the user story
         lines (As a, I want, So that) anywhere in the body, and done_when (the acceptance
         criteria): file paths, function or class names, camelCase or snake_case identifiers,
         backtick code, HTTP verbs, SQL or database terms, and a small set of library names.
         Module plain names are allowed, and so is a confirmed permission key written as an inline
         code span `can <verb> <noun>`; any other code span is still flagged. TKT-2 is scoped: the
         full body is still scanned for TKT-1 and TKT-3, but code words are only reported in the
         scoped fields.
  TKT-3  no jargon from the deny-list in shared/references/plain-language.md; each entry carries a
         plain replacement that becomes the suggestion.
  TKT-4  no sentence over 30 words anywhere in the text; a longer sentence is flagged to be split.

Standard library only. No network. Read-only.

CLI:
  check_prose.py --ticket-set <ticket-set.json>
  check_prose.py --path <file.md>

stdout: {"ok", "issues": [{"code", "path", "message", "suggestion"}]}. Exit 0 clean, 1 on any
finding.
"""

import argparse
import json
import re
import sys
from pathlib import Path

import canonical

DEFAULT_DENYLIST = (Path(__file__).resolve().parents[1]
                    / "references" / "plain-language.md")

EM_DASH = "\u2014"
EN_DASH = "\u2013"

# TKT-4: a ticket sentence must stay short. A sentence over this many words is flagged.
MAX_SENTENCE_WORDS = 30
SENTENCE_END = re.compile(r"[.!?]+")

# Scoped section headings (case-insensitive substring match) that carry the TKT-2 code-word rule
# inside a ticket or epic body. Everything else in the body is scanned for TKT-1 and TKT-3 only.
CODE_SCOPED_HEADINGS = ("goal", "what they need")
# User story lines carry TKT-2 wherever they sit in a body, with or without a scoped heading.
STORY_LINE = re.compile(r"^\s*\*\*(?:As an?|I want|So that)\*\*", re.IGNORECASE)
# A permission key confirmed with the user (`can view savings`) is the one allowed code span.
PERMISSION_KEY = re.compile(r"`can [a-z]+(?: [a-z]+){1,3}`")

HEADING = re.compile(r"^\s*(?:(#{1,6})\s+(.*)|\*\*(.+?)\*\*\s*)$")
FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
INLINE_CODE = re.compile(r"(`+).*?\1")
URL = re.compile(r"https?://\S+")

# Code-word signals for TKT-2. The SQL and HTTP patterns are deliberately case-sensitive on their
# uppercase keyword forms so a common English word ("from", "get", "update") is not flagged.
BACKTICK = re.compile(r"`[^`]+`")
FILE_PATH = re.compile(r"(?<!\w)(?:[\w.-]+/)+[\w.-]*\.\w+")
DOTTED_FILE = re.compile(r"(?<!\w)[\w-]+\.(?:py|js|ts|tsx|jsx|java|rb|go|rs|sql|json|yaml|yml|md|sh|cfg|ini|xml|html|css)\b")
CALL = re.compile(r"(?<!\w)[A-Za-z_]\w*\(")
CAMEL = re.compile(r"(?<![\w])[a-z]+[A-Z]\w*")
SNAKE = re.compile(r"(?<![\w.])[a-z][a-z0-9]*(?:_[a-z0-9]+)+")
HTTP_VERB = re.compile(r"\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b")
SQL_UPPER = re.compile(r"\b(SELECT|INSERT|UPDATE|DELETE|JOIN|WHERE|FROM)\b")
DB_TERM = re.compile(r"\b(database|schema|foreign key|primary key|SQL|NoSQL)\b", re.IGNORECASE)
LIBRARY = re.compile(r"\b(react|redux|django|flask|numpy|pandas|express|spring|hibernate|"
                     r"kubernetes|docker|postgres|postgresql|mysql|mongodb|redis|kafka|"
                     r"webpack|babel|typescript|graphql|sqlalchemy)\b", re.IGNORECASE)


def load_denylist(path):
    """Return a list of (term, replacement) pairs from the plain-language deny-list file."""
    pairs = []
    text = Path(path).read_text(encoding="utf-8")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            stripped = stripped[2:].strip()
        if "->" not in stripped:
            continue
        left, _, right = stripped.partition("->")
        term = left.strip()
        replacement = right.strip()
        if term and replacement and " " not in term:
            pairs.append((term, replacement))
    return pairs


def term_pattern(term):
    """A term ending in * matches every word that starts with it (leverag* matches leveraging)."""
    if term.endswith("*"):
        return re.escape(term[:-1]) + r"\w*"
    return re.escape(term)


def finding(code, path, message, suggestion):
    return {"code": code, "path": path, "message": message, "suggestion": suggestion}


def code_word_hit(line):
    """Return a (message, suggestion) when the line holds a code word, else None.

    A confirmed permission key in inline code is removed first, so it is never a code word.
    """
    line = PERMISSION_KEY.sub("", line)
    if BACKTICK.search(line):
        return ("Backtick code in a plain-language field.",
                "Describe the behaviour in business words, not code.")
    if DOTTED_FILE.search(line) or FILE_PATH.search(line):
        return ("A file path appears in a plain-language field.",
                "Keep file paths out of ticket fields; put them on the Sources line.")
    verb = HTTP_VERB.search(line)
    if verb:
        return ("An HTTP verb ({0}) appears in a plain-language field.".format(verb.group(1)),
                "Describe the action in plain words.")
    sql = SQL_UPPER.search(line) or DB_TERM.search(line)
    if sql:
        return ("A database term ({0}) appears in a plain-language field.".format(sql.group(1)),
                "Describe the data in business words, not database terms.")
    lib = LIBRARY.search(line)
    if lib:
        return ("A library or tool name ({0}) appears in a plain-language field.".format(lib.group(1)),
                "Name the capability, not the library.")
    if CALL.search(line) and "(" in line:
        return ("A function or method call appears in a plain-language field.",
                "Describe what it does in plain words.")
    camel = CAMEL.search(line)
    if camel:
        return ("A code identifier ({0}) appears in a plain-language field.".format(camel.group(0)),
                "Use plain business words instead of an identifier.")
    snake = SNAKE.search(line)
    if snake:
        return ("A code identifier ({0}) appears in a plain-language field.".format(snake.group(0)),
                "Use plain business words instead of an identifier.")
    return None


def scan(lines, path, denylist, check_code):
    """Scan (number, line) pairs for TKT-1, TKT-3, and (when check_code) TKT-2.

    Fenced code blocks, blockquotes, inline-code spans and URLs are skipped for TKT-1 and TKT-3 so
    quoted evidence is never rewritten. TKT-2 is checked on the raw line (minus fence/blockquote
    skipping) so backtick code is itself reported as a code word.
    """
    issues = []
    fence = None
    for number, line in lines:
        match = FENCE.match(line)
        if match:
            marker = match.group(1)
            if fence is None:
                fence = marker
            elif marker[0] == fence[0] and len(marker) >= len(fence):
                fence = None
            continue
        if fence is not None or line.lstrip().startswith(">"):
            continue
        where = "{0}:{1}".format(path, number)

        if check_code:
            hit = code_word_hit(line)
            if hit:
                issues.append(finding("TKT2", where, hit[0], hit[1]))

        prose = INLINE_CODE.sub("", line)
        prose = URL.sub("", prose)

        if EM_DASH in prose or EN_DASH in prose:
            issues.append(finding(
                "TKT1", where,
                "Em or en dash used as a dash. Ticket text uses ASCII hyphens only.",
                "Rewrite the sentence, or use a plain hyphen, a comma or a full stop."))

        folded = prose.casefold()
        for term, replacement in denylist:
            hit = re.search(r"\b" + term_pattern(term) + r"\b", folded)
            if hit:
                issues.append(finding(
                    "TKT3", where,
                    "Jargon '{0}' in ticket prose.".format(hit.group(0)),
                    "Use '{0}' instead of '{1}'.".format(replacement, hit.group(0))))

        for piece in SENTENCE_END.split(prose):
            count = len(piece.split())
            if count > MAX_SENTENCE_WORDS:
                issues.append(finding(
                    "TKT4", where,
                    "A sentence runs to {0} words; ticket sentences stay at {1} or fewer.".format(
                        count, MAX_SENTENCE_WORDS),
                    "Split the sentence into shorter ones."))
    return issues


def body_sections(body):
    """Return (heading, start_number, lines) tuples split by Markdown or bold heading."""
    sections = []
    heading = ""
    start = 1
    collected = []
    for number, line in enumerate(body.splitlines(), 1):
        match = HEADING.match(line)
        if match:
            if collected:
                sections.append((heading, start, collected))
            heading = (match.group(2) or match.group(3) or "").strip()
            start = number + 1
            collected = []
        else:
            collected.append((number, line))
    if collected:
        sections.append((heading, start, collected))
    return sections


def code_scoped_lines(body):
    """Return the ordered, de-duplicated (number, line) pairs of a body that carry TKT-2.

    These are the lines under a CODE_SCOPED_HEADINGS heading plus every user story line anywhere
    in the body, so a story line under a scoped heading is scanned once, not twice.
    """
    picked = set()
    for heading, _start, lines in body_sections(body):
        if any(name in heading.casefold() for name in CODE_SCOPED_HEADINGS):
            picked.update(number for number, _line in lines)
    body_lines = list(enumerate(body.splitlines(), 1))
    picked.update(number for number, line in body_lines if STORY_LINE.match(line))
    return [(number, line) for number, line in body_lines if number in picked]


def lint_item(path_prefix, title, body, done_when, denylist):
    """Lint one ticket or epic: title and done_when carry TKT-2; the body is scoped."""
    issues = []
    # Title: TKT-1, TKT-3 and TKT-2.
    issues.extend(scan(list(enumerate(title.splitlines() or [title], 1)),
                       path_prefix + ":title", denylist, check_code=True))
    # Body: the whole body for TKT-1 and TKT-3.
    body_lines = list(enumerate(body.splitlines(), 1))
    issues.extend(scan(body_lines, path_prefix + ":body", denylist, check_code=False))
    # Scoped sections and story lines of the body for TKT-2 only.
    for issue in scan(code_scoped_lines(body), path_prefix + ":body", denylist, check_code=True):
        if issue["code"] == "TKT2":
            issues.append(issue)
    # done_when: each statement carries all three rules.
    for index, statement in enumerate(done_when or []):
        prefix = "{0}:done_when[{1}]".format(path_prefix, index)
        issues.extend(scan(list(enumerate(str(statement).splitlines() or [str(statement)], 1)),
                           prefix, denylist, check_code=True))
    return issues


def lint_ticket_set(ticket_set, denylist):
    issues = []
    for epic in ticket_set.get("epics", []):
        epic_ref = epic.get("ref", "?")
        issues.extend(lint_item(
            "epics[{0}]".format(epic_ref),
            str(epic.get("title", "")),
            str(epic.get("body_markdown", "")),
            [], denylist))
        for ticket in epic.get("tickets", []):
            ticket_ref = ticket.get("ref", "?")
            issues.extend(lint_item(
                "tickets[{0}]".format(ticket_ref),
                str(ticket.get("title", "")),
                str(ticket.get("body_markdown", "")),
                ticket.get("done_when", []),
                denylist))
    return issues


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check ticket prose (TKT-1, TKT-2, TKT-3, TKT-4).")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ticket-set", type=Path)
    group.add_argument("--path", type=Path)
    parser.add_argument("--denylist", type=Path, default=DEFAULT_DENYLIST)
    args = parser.parse_args(argv)

    denylist = load_denylist(args.denylist)
    if args.ticket_set is not None:
        ticket_set = canonical.load(args.ticket_set)
        issues = lint_ticket_set(ticket_set, denylist)
    else:
        document = args.path.read_text(encoding="utf-8")
        # A single document is scanned for TKT-1 and TKT-3 over its whole text.
        issues = scan(list(enumerate(document.splitlines(), 1)),
                      str(args.path), denylist, check_code=False)

    print(json.dumps({"ok": not issues, "issues": issues}, indent=2, ensure_ascii=False))
    return 1 if issues else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
