#!/usr/bin/env python3
"""Offline structural-parity harness for AC-20 (ChatGPT and Codex parity).

This is NOT a live cross-host eval. A live ChatGPT or Codex driver is infeasible under the stack
constraints (Python 3.9 standard library only, no third-party packages, no network), and CI-12
records no documented live runner for those hosts, so the live conversational parity stays manual
and recorded per CI-12 and is left to S3. What this harness proves is the STRUCTURAL half of AC-20,
derivable offline from the built per-host branches and the static fixtures, never from live model
prose:

  (1) same journey            the skill set, the entry-skill set and the step-and-skill graph are
                              identical for every host branch and cover the entry skills s2.yml
                              declares;
  (2) same answer structure   the answer-template shape (ask-project) and the record-block shape
                              (product-discovery) are identical for every host branch;
  (3) same ticket-set         the ticket-set.schema.json each branch ships is identical, a canonical
                              ticket-set validates clean against it, and the capability-stripped
                              posting path (no link action, U-3) preserves every dependency so the
                              ticket-set structure is unchanged under stripping.

The capability-stripped variant's other requirements (U-1 checklist, U-14 sprint by hand, U-16
append marked section, GRD-3 attach docs, REC-2 chat summary) are authored-content guarantees proven
by tests/scripts/test_authoring.py; this harness proves the structural dimensions above.

Standard library only (Python 3.9+). No network. Reads the built dist and the fixtures; writes
nothing. Deterministic: same inputs produce the same findings in the same order.

CLI:
  run_parity.py [--dist <dist-root>] [--scenarios <s2.yml>]

stdout: {"ok", "findings"}. Exit 0 when parity holds, 1 on any finding (fails loudly, never a silent
empty pass).
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))

# Reuse the real shipped helpers rather than re-deriving them (one canonical source each).
for _entry in (
    os.path.join(REPO_ROOT, "build"),
    os.path.join(REPO_ROOT, "shared", "scripts"),
    os.path.join(REPO_ROOT, "skills", "check-tickets", "scripts"),
    os.path.join(REPO_ROOT, "skills", "post-tickets", "scripts"),
):
    if _entry not in sys.path:
        sys.path.insert(0, _entry)

import build  # noqa: E402
import canonical  # noqa: E402
import check_ticket_set  # noqa: E402
import plan_posting  # noqa: E402

DEFAULT_DIST = os.path.join(REPO_ROOT, "dist")
DEFAULT_SCENARIOS = os.path.join(HERE, "scenarios", "s2.yml")
SKILLS_YML = os.path.join(REPO_ROOT, "build", "skills.yml")

STEP_PHRASE = "journey directs it"


# --------------------------------------------------------------------------- minimal YAML reader


def _scalar(value):
    value = value.strip()
    if value == "[]":
        return []
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        return value[1:-1]
    return value


def _is_mapping_item(inner):
    if not inner:
        return False
    if inner[0] in ("'", '"'):
        return False
    return ": " in inner or inner.endswith(":")


def _parse_mapping(lines, i, indent):
    result = {}
    while i < len(lines):
        cur_indent, content = lines[i]
        if cur_indent != indent:
            break
        key, _sep, val = content.partition(":")
        key = key.strip()
        val = val.strip()
        if val:
            result[key] = _scalar(val)
            i += 1
        else:
            i += 1
            if i < len(lines) and lines[i][0] > indent:
                child, i = _parse_block(lines, i, lines[i][0])
                result[key] = child
            else:
                result[key] = None
    return result, i


def _parse_sequence(lines, i, indent):
    items = []
    while i < len(lines):
        cur_indent, content = lines[i]
        if cur_indent != indent or not content.startswith("- "):
            break
        inner = content[2:].strip()
        if _is_mapping_item(inner):
            inner_indent = indent + 2
            item_lines = [(inner_indent, inner)]
            i += 1
            while i < len(lines) and lines[i][0] >= inner_indent:
                item_lines.append(lines[i])
                i += 1
            item, _ = _parse_mapping(item_lines, 0, inner_indent)
            items.append(item)
        else:
            items.append(_scalar(inner))
            i += 1
    return items, i


def _parse_block(lines, i, indent):
    if i >= len(lines):
        return None, i
    _cur_indent, content = lines[i]
    if content.startswith("- "):
        return _parse_sequence(lines, i, indent)
    return _parse_mapping(lines, i, indent)


def parse_yaml(text):
    """Parse the restricted YAML subset s2.yml uses (comments, scalars, block lists of scalars and
    of mappings, one level of nested lists). Not a general YAML parser."""
    lines = []
    for raw in text.splitlines():
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        lines.append((indent, stripped))
    value, _ = _parse_block(lines, 0, 0)
    return value or {}


def load_scenarios(path):
    with open(path, "r", encoding="utf-8") as handle:
        return parse_yaml(handle.read())


# --------------------------------------------------------------------------- branch profiles


def _read(path):
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read()


def branch_skills_root(dist_root, host, plugin_name):
    return os.path.join(dist_root, "hosts", host, "plugins", plugin_name, "skills")


def _unquote_scalar(value):
    """Return a one-line frontmatter value without its YAML quotes (double or single)."""
    if len(value) >= 2 and value[0] == value[-1] == '"':
        return json.loads(value)
    if len(value) >= 2 and value[0] == value[-1] == "'":
        return value[1:-1].replace("''", "'")
    return value


def _skill_description(skill_md_text):
    """Return the frontmatter description of a SKILL.md (one logical line)."""
    lines = skill_md_text.splitlines()
    if not lines or lines[0].strip() != "---":
        return ""
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line.startswith("description:"):
            return _unquote_scalar(line.partition(":")[2].strip())
    return ""


def _step_graph(product_discovery_md):
    """Extract the (step, step-skill) rows from the product-discovery six-steps table."""
    graph = []
    for line in product_discovery_md.splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 3:
            continue
        step, skill = cells[0], cells[1]
        # Skip the header and divider rows; keep rows whose second cell is a skill name.
        if re.match(r"^[0-9]+\.", step) and re.match(r"^[a-z][a-z-]+$", skill):
            graph.append((step, skill))
    return tuple(graph)


def _answer_shape(answer_template_md):
    """The ordered markdown headers of the answer template -- its answer-structure shape."""
    return tuple(
        line.strip()
        for line in answer_template_md.splitlines()
        if line.startswith("#")
    )


def _record_blocks(record_template_md):
    """The top-level block keys of the record template JSON -- its record-block shape."""
    start = record_template_md.find("{")
    end = record_template_md.rfind("}")
    if start == -1 or end == -1:
        return tuple()
    parsed = json.loads(record_template_md[start:end + 1])
    return tuple(sorted(parsed.keys()))


def collect_branch_profile(skills_root):
    """Return the structural profile of one host branch's skills tree, or None when absent."""
    if not os.path.isdir(skills_root):
        return None
    skills = set()
    entry_skills = set()
    for name in sorted(os.listdir(skills_root)):
        skill_md = os.path.join(skills_root, name, "SKILL.md")
        if not os.path.isfile(skill_md):
            continue
        skills.add(name)
        description = _skill_description(_read(skill_md))
        if STEP_PHRASE not in description:
            entry_skills.add(name)

    def read_skill_file(skill, *parts):
        path = os.path.join(skills_root, skill, *parts)
        return _read(path) if os.path.isfile(path) else ""

    return {
        "skills": frozenset(skills),
        "entry_skills": frozenset(entry_skills),
        "step_graph": _step_graph(read_skill_file("paqad-discover", "SKILL.md")),
        "answer_shape": _answer_shape(
            read_skill_file("paqad-ask", "references", "answer-template.md")
        ),
        "record_blocks": _record_blocks(
            read_skill_file("paqad-discover", "assets", "record-template.md")
        ),
        "ticket_schema": read_skill_file(
            "paqad-write-tickets", "assets", "ticket-set.schema.json"
        ),
    }


# --------------------------------------------------------------------------- ticket-set fixture


def canonical_ticket_set():
    """A small valid ticket set with dependencies, sealed with its canonical digest."""
    def ticket(ref, title, deps=None):
        return {
            "ref": ref,
            "title": title,
            "body_markdown": "## What they need and why\nMembers want " + title.lower() + ".",
            "done_when": ["A member can " + title.lower(), "It works reliably"],
            "depends_on": deps or [],
            "assignee_hint": None,
        }

    ts = {
        "run_id": "DR-20261006-PAR1",
        "revision": 0,
        "digest": "",
        "tracker": {
            "kind": "jira",
            "project_key": "ABC",
            "epic_type": "Epic",
            "story_type": "Story",
        },
        "epics": [
            {
                "ref": "E1",
                "title": "Self-serve pause",
                "labels": ["paqad-discovery"],
                "body_markdown": "## Goal\nLet members pause their own plan.",
                "tickets": [
                    ticket("E1-T1", "pause a plan"),
                    ticket("E1-T2", "resume a plan", deps=["E1-T1"]),
                ],
            }
        ],
    }
    ts["digest"] = canonical.digest({k: v for k, v in ts.items() if k != "digest"})
    return ts


def dependency_count(ticket_set):
    return sum(
        len(t.get("depends_on", []) or [])
        for epic in ticket_set.get("epics", [])
        for t in epic.get("tickets", [])
    )


# --------------------------------------------------------------------------- parity check


def check_parity(dist_root=DEFAULT_DIST, scenarios_path=DEFAULT_SCENARIOS,
                 plugin_name=None, ticket_set=None):
    """Return a list of parity findings. An empty list means AC-20 structural parity holds."""
    findings = []
    scenarios = load_scenarios(scenarios_path)
    hosts = scenarios.get("hosts") or []
    declared_entry = set(scenarios.get("entry_skills") or [])
    if not hosts:
        findings.append("s2.yml declares no hosts to compare.")
        return findings
    if not declared_entry:
        findings.append("s2.yml declares no entry skills.")
        return findings

    if plugin_name is None:
        plugin_name = build.load_config(SKILLS_YML)["name"]

    profiles = {}
    for host in hosts:
        profile = collect_branch_profile(branch_skills_root(dist_root, host, plugin_name))
        if profile is None:
            findings.append("host branch missing or has no skills tree: {0}".format(host))
            continue
        profiles[host] = profile

    if len(profiles) < len(hosts):
        # A missing branch is already a fatal divergence; report and stop before comparing.
        return findings

    reference_host = hosts[0]
    reference = profiles[reference_host]
    compared = (
        "skills",
        "entry_skills",
        "step_graph",
        "answer_shape",
        "record_blocks",
        "ticket_schema",
    )
    for host in hosts[1:]:
        for key in compared:
            if profiles[host][key] != reference[key]:
                findings.append(
                    "parity break on {0}: {1} differs from {2}".format(key, host, reference_host)
                )

    # Every declared entry skill is present as an entry skill in every branch (fail loudly).
    for host in hosts:
        missing = declared_entry - set(profiles[host]["entry_skills"])
        if missing:
            findings.append(
                "host {0} is missing declared entry skill(s): {1}".format(
                    host, ", ".join(sorted(missing))
                )
            )

    # Same ticket-set structure: the canonical ticket set validates clean against the one schema.
    ts = ticket_set if ticket_set is not None else canonical_ticket_set()
    ts_errors = check_ticket_set.check(ts)
    if ts_errors:
        findings.append(
            "the ticket set does not validate against ticket-set.schema.json: {0}".format(
                "; ".join(e["code"] for e in ts_errors)
            )
        )

    # Capability-stripped (U-3): with no link action the posting plan must preserve every
    # dependency as a Depends on text line, so the ticket-set structure is unchanged under stripping.
    stripped_plan = plan_posting.build_plan(
        ts, {"run_label": "dr-parity"}, {"actions": ["createIssue"]}
    )
    if not stripped_plan.get("links_by_hand"):
        findings.append("capability-stripped posting did not fall back to links-by-hand (U-3).")
    if len(stripped_plan.get("depends_on_lines", [])) != dependency_count(ts):
        findings.append(
            "capability-stripped posting dropped a dependency instead of rendering it by hand (U-3)."
        )

    return findings


def main(argv=None):
    parser = argparse.ArgumentParser(description="Offline AC-20 structural-parity harness.")
    parser.add_argument("--dist", default=DEFAULT_DIST)
    parser.add_argument("--scenarios", default=DEFAULT_SCENARIOS)
    args = parser.parse_args(argv)

    dist_root = args.dist
    if not os.path.isdir(os.path.join(dist_root, "hosts")):
        # Build the dist in place so the harness never passes vacuously on a missing build.
        build.build(REPO_ROOT, dist_root)

    findings = check_parity(dist_root=dist_root, scenarios_path=args.scenarios)
    print(json.dumps({"ok": not findings, "findings": findings}, indent=2, ensure_ascii=False))
    return 1 if findings else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
