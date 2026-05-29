# Rule script authoring contract

Every generated rule script is a Node ESM (`.mjs`) file. No `.sh` — see issue #89 rationale (cross-machine bash/jq/sed landmines; Node is pinned `>=22` everywhere paqad runs).

## File layout

```
.paqad/scripts/rules/<mirror>/<rule-filename>/
├── 001-<short-name>.mjs
└── 001-<short-name>/
    └── __fixtures__/
        ├── pass/   (2–4 files; each MUST yield zero findings)
        └── fail/   (2–4 files; each MUST yield ≥1 finding)
```

`<mirror>` mirrors the rule file's path under `docs/instructions/rules/` (e.g. `coding/code-quality`).

## Header (validated before every run)

```js
// @paqad-rule-script
// rule_id: RL-7f3a
// source: docs/instructions/rules/coding/code-quality.md
// kind: deterministic            // deterministic | heuristic
// scope: changed-files           // changed-files | whole-tree | git-diff | git-history
// runtime: node
// requires: {"node":">=22","binaries":["git"]}   // optional; JSON
// last_validated_at: 2026-05-29T00:00:00Z         // optional
// false_positive_surface: "Hook files that legitimately call services."  // optional
```

`requires` must be valid JSON. Declared binaries are checked at run time; a missing one yields a clean "missing dependency" finding and skips just that script — it never crashes the stage.

## I/O contract

- Invoked as `node <script>.mjs` with **no args**.
- Reads a JSON payload from **stdin**: `{ "projectRoot": "<abs>", "files": ["rel/path.ts", ...] }`.
- Resolves each file with `join(projectRoot, file)`.
- Writes the findings report to **stdout**, nothing else:

```json
{
  "rule_id": "RL-7f3a",
  "kind": "deterministic",
  "findings": [
    { "file": "src/foo.ts", "line": 42, "message": "debugger statement", "severity": "blocker" }
  ]
}
```

`severity ∈ {critical, blocker, high, medium, low, nit, info}`. `line` is optional. An empty `findings` array means the file passed.

## Skeleton

```js
// @paqad-rule-script
// rule_id: RL-7f3a
// source: docs/instructions/rules/coding/code-quality.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const file of files) {
  const text = readFileSync(join(projectRoot, file), 'utf8');
  text.split('\n').forEach((line, i) => {
    if (/\bdebugger\b/.test(line)) {
      findings.push({ file, line: i + 1, message: 'debugger statement', severity: 'blocker' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-7f3a', kind: 'deterministic', findings }));
```

## Fixtures are the test of the test

- **Synthetic, 5–15 lines, hand-crafted** — never extracted from the user's real code (privacy, stability, clarity).
- **pass/** files demonstrate the rule satisfied → zero findings.
- **fail/** files demonstrate the rule violated → ≥1 finding each.
- If `validate-script.mjs` reports any mismatch, the script is **rejected** and must be regenerated, edited, or the rule marked unverifiable — it is never registered.
