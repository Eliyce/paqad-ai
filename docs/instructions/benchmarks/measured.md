# Measured benchmarks

Two numbers a team can check, each with the method, the run count, the date, the
tokenizer, and the caveats printed next to it. Nothing here is estimated. Every figure
is produced by a script in `scripts/`, and the command that reproduces it is named
below. If a number is not reproducible by running the named command, it does not belong
on this page.

The `overview.md` sibling holds the fixed gate thresholds (framework-internal defaults).
This page holds what was actually measured.

## Headline (a): resident-token footprint

**What it measures.** The instruction text paqad makes an agent load at session start,
per the framework bootstrap contract: the host entry file, the resident rule slice, and
the `stack`, `design-system`, and `workflows` areas. Everything else under
`docs/instructions` loads on demand and is reported separately, never counted in the
resident number.

Lean rule loading (issue #284, default on) is the reason the resident number is small:
instead of the whole `docs/instructions/rules` tree, a session carries an always-present
**manifest** (one capped line per rule) plus the rule bodies for the files in play. The
manifest is the stable resident floor; the loaded rule bodies vary per session and are
listed on their own line, not folded into the headline.

**Measured range: 49% to 61% smaller resident load than loading the full rule tree**, on
the two projects measured so far (N = 2 projects, heuristic tokenizer). This is smaller
than the retired "60-85%" README claim, and it is the number that reproduces.

| Project | Stack | Resident (tokens) | Full load, lean off (tokens) | Reduction | Tokenizer |
| --- | --- | --- | --- | --- | --- |
| paqad-ai repo (dogfooded self-host) | mixed TypeScript | 14,213 | 36,779 | 61% | heuristic (char/4) |
| fresh onboarded fixture | React + Vite | 8,270 | 16,243 | 49% | heuristic (char/4) |

Per-project values vary with rule count and docs size, so this is published as a range,
not one universal number. The paqad-ai row is the reproducible anchor (clone the repo and
run the command); the fixture row is a temp-dir onboard, the pattern in
`tests/e2e/onboarding.e2e.test.ts`.

<details>
<summary>Per-area breakdown — paqad-ai repo (2026-07-03)</summary>

| Area | Load | Files | Tokens |
| --- | --- | --- | --- |
| rules (full tree) | on-demand | 42 | 31,777 |
| rules-manifest | resident | 1 | 9,211 |
| workflows | resident | 3 | 3,458 |
| registries | on-demand | 2 | 2,843 |
| architecture | on-demand | 1 | 1,606 |
| rules-loaded (task-varying) | task-loaded | 1 | 1,585 |
| stack | resident | 2 | 967 |
| benchmarks | on-demand | 1 | 678 |
| tools | on-demand | 6 | 611 |
| tech-debt | on-demand | 1 | 513 |
| design-system | resident | 1 | 443 |
| entry | entry | 1 | 134 |

Resident = entry + rules-manifest + workflows + stack + design-system = 14,213 tokens.
The full rule tree (31,777 tokens) stays on demand; it is not resident.

</details>

**Reproduce it:**

```
node scripts/measure-footprint.mjs --project <path>     # markdown table
node scripts/measure-footprint.mjs --project <path> --json
```

Run it in any project. It is read-only, works with `rag_enabled` off (the default), and
works in a repo with no `.paqad/` at all (it reports what it finds and exits 0).

## Headline (b): deterministic findings caught

**What it measures.** How many deterministic rule findings were present per fresh
rule-script run, read from the `rule-evidence` ledger, bucketed by ISO week.

**The honest definition.** The rule runner appends a ledger row only on a fresh run (a
cache hit appends nothing), and each row counts the findings **present** at that run, not
new catches since last time. Summing rows would double-count a persistent finding. So the
metric is the per-fresh-run snapshot, reported as a weekly **median and max**, never a
running total.

**Data today: none yet.** The dogfooded paqad-ai repo has no `rule-evidence` rows, so
there is no weekly table to publish here (N = 0 runs). The metric and the command are
defined so any onboarded project can populate and read it. This is the honest state, not
a placeholder for an invented number.

**Reproduce it:**

```
node scripts/rule-findings-stats.mjs --project <path>     # markdown
node scripts/rule-findings-stats.mjs --project <path> --json
```

On a project with no ledger rows it prints "no data" and exits 0.

## Which hosts fed which number (per HOOK_COVERAGE_MATRIX)

Both numbers apply differently across the 11 providers, matching
`HOOK_COVERAGE_MATRIX` (`src/adapters/shared/paqad-hooks.ts`):

- **Footprint (headline a)** applies to **all 11 providers**. Every adapter renders an
  entry file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/paqad.mdc`,
  `.windsurfrules`, and so on) that points at the same `docs/instructions/` load, so the
  number varies per project, not per host.
- **Findings (headline b)** is fed only where the rule runner actually executes: the
  live-hook host (`claude-code`), the completion-hook hosts (`codex-cli`, `gemini-cli`),
  and manual or skill-invoked runs anywhere. Advisory hosts (`cursor`, `windsurf`,
  `continue`, `github-copilot`, `junie`, `aider`, `antigravity`, `aiassistant`) contribute
  ledger rows only from manual runs. No enforcement or automatic measurement happens on
  advisory hosts, and nothing here claims it does.

## Caveats

- **Small project count.** N = 2 projects for the footprint, N = 0 runs for the findings.
  A range from two projects is a range from two projects, not a population.
- **Heuristic tokenizer.** Both footprint rows used the char/4 fallback because
  `@xenova/transformers` was not loadable at measurement time. The script labels this in
  its output; install the optional peer dep for exact token counts, and the reduction
  percentages are stable under either tokenizer because both sides are counted the same way.
- **Snapshot, not incremental, findings.** The findings metric is per-fresh-run presence,
  not new catches. See the definition above.
- **Task-varying loaded rule text.** The resident number is the manifest floor. The rule
  bodies loaded for the files in play (the `rules-loaded` line) change per session and are
  reported apart from the headline.
- **Retrieval quality is not published here.** The F15 eval harness
  (`src/rag/eval-runner.ts`, gated by `src/rag/benchmark-gates.ts`) runs on a synthetic
  12-item dataset and stays the internal merge gate for retrieval changes. No hit@5 or
  task-success number from it is published as a product claim. Run
  `paqad-ai rag eval --mode feature-off-vs-on` to see the gate; its dataset is synthetic.

## Method notes

- Token counts come from `src/context/tokenizer-cache.ts` (the one tokenizer path), with a
  labelled char/4 fallback. The findings reader is the existing `rule-evidence` ledger via
  `readProjectEvents` (`src/session-ledger/project-ledger.ts`); no new evidence store was
  added, and `.paqad/scripts/rules/.cache/report.json` is the engine's hash-cache, not a
  data source for this page.
- The scripts live in `scripts/` (repo tooling), outside the coverage gate, and change no
  product behavior. `rag_enabled` stays default off.
