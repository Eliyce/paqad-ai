# Find related areas: API

This feature has no network or HTTP API. The plugin ships no integration code of its own
(D-4, PLG-2); every repository read goes through the host's own tools.

Its one script, `scripts/find_related.py` (`shared/scripts/find_related.py`, copied into the
`ask-project` and `ground-in-project` skills at build time), ranks the project's areas against an
idea or a question. It is read-only and writes nothing.

```
find_related.py (--registry <modules.md> | --modules-dir <docs/modules>) --query "<idea or question>"
```

| Exit | When | Output |
|---|---|---|
| 0 | Source read (and, for `--modules-dir`, at least one area with a summary) | JSON list `[{"module", "plain_name", "score", "matched_terms"}]` in rank order on stdout; `[]` means nothing matched |
| 1 | Registry unreadable, modules folder missing or not a folder, or no area with a summary | `{"ok": false, "error": "<message>"}` on stderr, nothing on stdout |
| 2 | Both or neither source, or no `--query` | `argparse` usage error on stderr |

The full contract (row shape, term matching, ordering) is in
[Find related areas: technical](technical.md).

The feature also owns two references the skills follow, with no script behind them:
`references/paqad-docs-map.md` (reading order and what the documents prove, GRD-2, GRD-5,
GRD-8 to GRD-11) and `references/evidence-levels.md` (the three evidence levels, the source line,
the informational nudge and the code-only finder, GRD-12 to GRD-16). The nudge's only outbound
link is the static `https://paqad.ai/?src=discovery-plugin`; the plugin never builds or changes it.
