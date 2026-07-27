# Plan — Building the Site Map & Journeys capability the right way

Status: **plan awaiting owner approval** (no code until approved). Owner: Haider. Date: 2026-07-27.
Companion: [`site-map-capability.proposal.md`](./site-map-capability.proposal.md) (the functional design: vocabulary, artifacts, consumers). This document supersedes the proposal's rollout section and adds the **operating model**: the dedicated agents, the fine-grained skills, the script-guided stages, the guardrails, and the verification — inspired by the feature-development workflow, not copied from it.

Grounded in three research passes: the feature-development stage policy and registry (read directly), a deep audit of how paqad's staged workflows actually run (pentest, design-test, codebase-health, stage-evidence ledger, agent roles, skill composition), and two targeted web-research sweeps answering the owner's two questions (LLM comprehension; human visual confidence).

---

## 0. The plan in one page

- **One new routed workflow, `site-map`** (plus `site-map-retest`), triggered by `create site map`, sitting beside the other ten workflows.
- **Architecture = the codebase-health pattern, shaped by design-test's contract discipline**: one deterministic CLI verb family owns the run mechanics (run bundle, resumability, hashing, validation); a prose rule tells the LLM its procedure; the LLM only orchestrates, judges, and narrates. *"Detection is deterministic and costs zero model tokens"* is the guiding sentence.
- **Ten stages** in a drift-tested registry: readiness → extraction → modeling → flow-tracing → journey-synthesis → assembly → verification → curation → publication → receipt. Every stage has a contract (inputs, executor, rigid artifact, gate, escalation) and an honest enforcement tier (SCRIPT-ENFORCED vs AGENT-RAISED → DECISION-PAUSE-ENFORCED).
- **Twelve fine-grained skills** — each does exactly one thing, each a full folder (SKILL.md + references/ + assets/ + scripts/ + agents/), each following "script finds → LLM judges → script grades the output".
- **Two new agent roles** (`app-cartographer`, `journey-designer`) plus four reused ones (verifier, gap-detector, adversarial-reviewer, doc-maintainer), with separated incentives: the role that draws the map never verifies it.
- **Feature-development keeps the map alive**: its `documentation_sync` stage gains a site-map maintainer path, and map staleness gets a gate that is *genuinely script-enforced* (extraction fingerprints are deterministic — stronger than today's stale-docs judgment gate).
- **Research verdicts that shaped everything**: deterministically-extracted, evidence-anchored maps measurably help agents (+12.2% accuracy, −54% time in the closest published analog) while *LLM-narrated* context prose measurably hurts (−3% success, +20% cost) — so scripts extract, the LLM only names and explains. And human confidence comes from legibility + honesty + guidance (districts and named paths, evidence-on-click, a guided first journey), not from prettiness.

---

## Part I — The two research questions, answered

### I.A — "How technically will it be easiest for an LLM to know our application?"

The 2025–2026 evidence converges on a **two-layer delivery system**, and it validates the script-first build philosophy directly:

1. **Extract, never narrate.** The only published with/without ablations on commercial agents (Claude Code, Cursor, Codex) show a deterministic, evidence-backed architectural map improving repo-comprehension accuracy by **+12.2%** and cutting time-to-answer by **~54%** (RIG, arXiv 2601.10112); graph-guided navigation lifts SWE-bench materially (RepoGraph +32.8% relative; LocAgent 92.7% file-level localization). Meanwhile a controlled ETH Zurich study found **LLM-generated context files *reduce* success ~3% and raise cost >20%** — because they restate what agents can infer. Conclusion baked into this plan: **scripts produce the map's facts; the LLM contributes only the non-inferable parts** (names, domain intent of journeys, guard semantics) — which is exactly the content the same study shows *earns* its tokens (+4% for human-quality, non-inferable context).
2. **A tiny always-loaded index, everything else just-in-time.** Attention is a budget; bloated context files get ignored ("Would removing this cause mistakes?" is Anthropic's litmus). The plan ships a **≤1k-token `index.md`** in the always-load tier and keeps the full map as per-area/per-journey YAML loaded at the moment of the edit — the skills-style 3-tier progressive disclosure that is now the proven loading pattern.
3. **Name it or lose it — the 160x effect.** Artifacts explicitly referenced with usage triggers in the agent's root context get used ~160x more; unreferenced files (the llms.txt-on-the-web failure) get used never. The bootstrap therefore gains one explicit rule: *"Before adding or changing any route, screen, command, or guard, consult `docs/instructions/site-map/` — and if an evidence line no longer matches the code, trust the code and flag map drift."* That last clause is the trust-but-verify contract the freshness research demands (stale context is *worse than none*: "the agent trusts your stale line more than its own observation").
4. **Aim the map at the #1 documented agent failure.** 67% of agent localization failures are picking the *wrong file among lookalike candidates*, and 35–40% of failed benchmark runs never find the right file. The map's core table — surface → owning `file:line`, with disambiguating annotations between similar surfaces — attacks precisely that. Second documented failure class: agents deleting or failing to wire auth (in one study, *every* generated codebase built auth middleware then failed to connect it to the WebSocket handler). **Guards-as-data** makes that checkable.
5. **Placement mechanics matter as much as content.** Mid-context degrades >30% (lost-in-the-middle); recency wins during work — so map *detail* is delivered as a just-in-time read near the edit, not preloaded 100k tokens earlier. Chunks are per-journey/per-area under stable slug headers (retrieval anchors); the index stays byte-stable across a session (prompt-cache friendly) and is named in compaction-preserve instructions. For large apps a later optional layer adds **2–4 narrow query verbs** (never a tool sprawl; tools are the reliably-invoked primitive, MCP resources are not).

**Net effect for paqad**: flow questions that today cost 15–40k tokens of router/controller spelunking become a ≤1k-token orientation plus a few-hundred-token evidence-anchored slice — grounded, verifiable, and delivered where attention actually is. (The plan keeps the earlier commitment: no README claim until the on/off flow-question benchmark exists, extending `benchmarks/measured.md` methodology.)

### I.B — "How visually will a user feel 'Yes, I know my application' — and make newbie onboarding super easy?"

The research answer has a name: **imageability** (Kevin Lynch). People feel they *know* a place when it has **districts, landmarks, and named paths** in a stable layout. Twelve ranked UX principles came out of the sweep; the load-bearing ones:

1. **Overview first, zoom and filter, details on demand** (Shneiderman) — the first render is 4–7 collapsed "districts" (app areas) with entry points marked, never the full graph. Node-link drawings die above ~3 edges/node density; clustering with expand-on-demand is the proven fix.
2. **Journeys are the product; the graph is the appendix.** Free-form path graphs are the most-complained-about feature in analytics tools (Mixpanel Flows); named top-N paths with "Others (k more)" bucketing are what humans can read. The Site map area leads with the curated journey list, not the hairball.
3. **Deterministic layered layout — the map never moves.** Sugiyama-style layers encode flow direction and preserve spatial memory across visits; force layouts re-randomize and destroy the mental map (and the Graph area's force layout is therefore *not* reused for this canvas — only the canvas machinery is).
4. **Provenance or it didn't happen.** Every node/edge/guard click-through lands on evidence (`file:line`, route dump, test). A global trust header states: *"Mapped from `main@abc123`, 2h ago · 42 surfaces · 9 journeys · 71% of transitions test-covered."* Honesty beats polish: show confidence **only when low** (CHI research: low-confidence flags are informative; high-confidence badges do nothing), and frame the gap panel as the tool auditing itself.
5. **Named, discrete zoom levels** (C4 pedagogy): App → Areas → Surfaces → Transition detail — each level a story for an audience, with Level 1 as the onboarding artifact. Advance-organizer research (effect size 0.41) is the science behind "see the whole journey before opening the app".
6. **The first five minutes are scripted** (action-gated, 3–5 steps — passive tours lose 78% of users by step three):
   - **0:00** — land on the district overview + trust header + one CTA: *"Follow the Signup journey (2 min)"*. Never an unexplained canvas.
   - **0:30** — guided playback of one real journey, max 5 stops; each stop shows the surface, what the user does there, the guard being crossed, and one evidence link; click-to-advance.
   - **2:00** — a persistent 3-item checklist (trace another journey from the top-5 picker; toggle the test-coverage overlay; open one gap finding) — checklists lift activation from ~25–30% to 40%+.
   - **4:00** — the "you know this app" recap card: minimap of where they've been, a plain-language auto-summary ("3 entry points; everything under /admin requires the admin role; the money path is Browse → Cart → Checkout"), and a suggested first task drawn from the gap panel — converting orientation into a first commit (the top-evidenced newcomer barrier is "finding a way to start").
7. **Text-first parity**: a searchable list-view twin of the canvas (search is how developers actually navigate — ~12 code searches/day at Google), keyboard traversal, ARIA graphics semantics, labels on the map (not in a side key), ≤6 categorical colors, one overlay at a time, changed-since-last-visit glow.
8. **Measured like activation, not completion**: time-to-first-journey-traced; % of new users who open ≥1 evidence link (trust proxy); newcomer time-to-first-commit.

One strategic lesson repeated across both sweeps: **standalone map products die (CodeSee, Sourcetrail, Octomind); maps embedded in recurring workflows with machine consumers live.** This plan therefore wires the map into feature development, verification gates, tests, and agent context from day one — the dashboard is a view of a working asset, not the asset.

---

## Part II — The operating model (the "very right way")

### II.1 Architecture principle: two layers, script-first

Every serious paqad workflow exists twice, deliberately, and site-map will too:

| Layer | Artifact | Owns |
| --- | --- | --- |
| **Prose rule** (the LLM's procedure) | `runtime/capabilities/coding/rules/site-map.md` (+ `site-map-retest.md`) | Purpose, triggers, source-of-truth model, the numbered stage procedure, escalation rules, footprint policy |
| **Deterministic driver** (the run mechanics) | the `paqad-ai sitemap …` verb family + a hand-written engine module | run bundle, stage sequencing, script fan-out, hashing, schema validation, skip/resume logic, report dual-write, exit codes |

The workflow-template engine is **not** the execution path (it cannot run scripts, its resume is index-only, and its steps require an injected runner — the exact reasons pentest and codebase-health are hand-written drivers). A `site-map.yaml` template may exist as documentation, but the driver is the truth.

The engine copies **codebase-health** (the most modern precedent): one deterministic verb produces the facts; an **injectable gatherer seam** makes the whole run testable offline; the LLM's job is reduced to *orchestrate → judge → narrate*; the **exit code is the verdict** (0 clean · 1 findings · 2 error). The contract shape copies **design-test**: a source-of-truth table, a script-derived readiness tier, a rich finding schema, a coverage matrix, and an explicit tunability policy.

### II.2 The source-of-truth model (who is evidence, who is on trial)

Copied from design-test's sharpest idea — every input is typed by role, and the map itself is *the subject under audit, never evidence for itself*:

| Source | Role in this workflow |
| --- | --- |
| Extractor script outputs (route dumps, file conventions, command trees, nav XML) | **primary evidence** |
| The live source code (walked for transitions/guards) | **primary evidence** |
| `docs/instructions/rules/module-map.yml` | **contract** for module attribution (the map joins to it, never redefines it) |
| Existing E2E tests, analytics call-sites, READMEs | **hints** for journey synthesis — help, not truth |
| `docs/instructions/site-map/**` (the map) | **subject under audit** — any disagreement with evidence is an `SM-*` drift finding, never silently trusted |
| Prior run bundle + baseline | comparison baseline for retest/diff |

### II.3 The stage pipeline

Inspired by feature-development's registry + policy split — same governance, different stages. A canonical stage order lives in one TS source, mirrored by a tracked `site-map-stages.yml`, protected by a drift test (the stage-registry mirror test pattern under `tests/unit/stage-evidence/` — note the YAML header's `registry-drift.test.ts` name is stale; the live assertion is in `independence.test.ts`). Stage policy (instructions, strictness, escalation per stage) lives in a `site-map` policy file the same way `feature-development.yaml` does it.

| # | Stage | Mandatory | Executor | What happens | Rigid artifact (script-written) | Gate / guardrail (tier) |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | `readiness` | ✔ | **Script** (+ decision pause if missing) | Tier derived by script — `missing / bare / adequate / strong` — from: onboarding manifest, detection report, pack site-map recipes, module-map presence, prior runs (fresh vs refresh vs retest) | `readiness.json` | SCRIPT-ENFORCED. `missing` → Decision-Pause packet offering `create documentation` inline; `bare` → proceed with `confidence: low` + findings about the missing contract itself |
| S1 | `extraction` | ✔ | **Scripts** (parallel fan-out, fixed env contract) | Per-stack extractors enumerate raw surfaces (routes, pages, screens, commands, jobs); normalized into a schema-validated `extraction.json` + **fingerprint**; unavailable extractors → `blocked-checks` `{check, reason, install_hint}` and proceed — *"a blocked check is a gap, not a pass"* | `extraction.json` | SCRIPT-ENFORCED: schema + ≥1 extractor ran or an explicit agent-led fallback is flagged low-confidence |
| S2 | `modeling` | ✔ | **LLM** (app-cartographer) | Raw entries become named surfaces: semantic slugs, titles, page types, entry/exit marks, module attribution (join to module map) — the *non-inferable* layer | surfaces layer (compiled by verb) | Script lints: slug rules, every surface carries resolving evidence, every extracted entry accounted for (mapped or excluded-with-reason) |
| S3 | `flow-tracing` | ✔ | **LLM** (two parallel skills) + script | `transition-tracing` and `guard-inference` run as a parallel skill group; every edge/guard gets trigger, evidence, confidence; then a **deterministic graph-analysis script** computes reachability, dead ends, guard coverage — zero tokens | transitions + guards layers | Script lints: targets exist, guards defined, evidence resolves; graph invariants recorded |
| S4 | `journey-synthesis` | ✔ | **LLM** (journey-designer) | Propose ≤ cap journeys (arc42 discipline): actor, one goal, entry, ordered steps (surface + action + expectation), branches, dual ends, composable sub-journeys; informed by tests/analytics/README hints; all marked `proposed` | journey files (`proposed`) | Script lints journey shape; cap enforced; every step references existing surfaces/transitions |
| S5 | `assembly` | ✔ | **Script** (CLI verb) | Merge layers → canonical `app-map.yaml` + journey files; AJV validation; cross-reference integrity; **human-curated/locked fields preserved** (module-map locked-entry semantics). The model fills templates; **the verb owns the stored bytes** (validates → hashes → writes → discards transient input) | the canonical map | SCRIPT-ENFORCED (hard fail on schema/integrity) |
| S6 | `verification` | ✔ | **Script first, bounded LLM second** | See §II.6 — the two-tier verification design | `verification.json` (claim verdicts + coverage matrix) | Tier A SCRIPT-ENFORCED; Tier B AGENT-RAISED with Decision-Pause on ambiguity |
| S7 | `curation` | ✔ (resolution may pend) | **Human** (via decision packets / dashboard Approvals) | Journey proposals reviewed in batch: confirm / rename / reprioritize / reject. Confirmed journeys become curated files refresh never clobbers | resolved decision packets | DECISION-PAUSE-ENFORCED. Unresolved ⇒ run verdict "Needs your attention"; the **map still publishes** (its value is not hostage to curation), journeys stay `proposed` |
| S8 | `publication` | ✔ | **Scripts** (+ LLM for narrative prose only) | Generate: token-budgeted `index.md`, `overview.md` with deterministic Mermaid, per-module `user-flows/` pages, registry projections (`screen-registry`, `api-registry`); register every output in the doc tracker (inheriting differential refresh + crash recovery); write/refresh the baseline; dual-write the run report `docs/site-map/<ts>.{md,json}`; append the session-ledger row | rendered outputs + baseline | SCRIPT-ENFORCED output lint (headings, budget, link integrity) |
| S9 | `receipt` | ✔ | **LLM narration** over script facts | One end-of-run receipt in the narration contract: verdict (**Safe to rely on / Needs your attention / Inconclusive**) + one line per stage with its honest evidence state | verify row in the run ledger | Completion gate: fold over stage rows; missing mandatory stage ⇒ never "complete" |

**Bookends:** `refresh` (differential re-run — unchanged inputs skip via per-step input hashes) and **`site-map-retest`** (a separate routed workflow, priority above the base, replaying prior `SM-*` findings and low-confidence claims against fresh evidence with verdicts `fixed / still-open / needs-manual-verification`, matched by **stable ID** — the codebase-health improvement over pentest's category matching).

### II.4 Run mechanics (all copied from proven code, listed for approval)

- **Run bundle**: `.paqad/site-map/runs/<run_id>/` with `progress.json`, `finding-index.json`, `blocked-checks.json`, `artifacts/`, `logs/`; `run_id` = local timestamp (newest-first directory scan); deliverable reports dual-written `.md` + `.json` (retest depends on the sidecar).
- **Resumability** (the pentest tracker, wholesale): re-invocation **rejoins** an incomplete run of the same workflow+source; crashed `running` steps reset to `not_started`; **per-stage input hashes** so a re-run skips untouched stages (changing only `routes/` re-runs extraction→assembly for that slice, not journey synthesis); progress saved after *every* transition; schema-validated on load.
- **Stage evidence**: a `site-map-run` doc type on the shared session-ledger substrate (~50-line registration, the codebase-health precedent) so every run lands in `paqad-ai audit export`. Thinking stages point at rigid, verb-written artifacts; bare markers fold *inconclusive* — the same honesty contract as feature-development ("proves a recorder ran over a real artifact — never that the stage was done well").
- **Findings**: the finding's *identity* is a content-addressed stable ID `SM-<hash8>` (sorted payload, collision suffix) — this is what retest matches on. Names like `SM-ADD` / `SM-GUARD-DRIFT` / `SM-I18N-*` (proposal §2.4, addendum §7) are values of the `category` field, never the ID. Two tiers per finding (`deterministic` vs `ai-judged`) with the report leading "Proven / Needs judgment", rich schema (`severity / category / surface / contract_ref / evidence / resolution / status`) where `resolution` must be concrete enough to fix without re-deriving context. The `SM-` prefix registers in the existing finding-normalizer vocabulary. A **baseline ratchet** (`baseline.json`, sorted IDs) marks later findings `new-since-baseline / pre-existing`.
- **Coverage matrix**: map claim × source-of-truth → `covered / blocked` — the WSTG/DS-COV analog, so "what the run could not check" is always explicit.

### II.5 The dedicated agents (multi-agent, honestly)

The framework's real model is **single-context role-switching** (roles render into each provider's native agent directory; parallelism happens at the script and skill level, and the plan parallelizes there). Roles are separated by incentive, mirroring "the requirement-analyst never writes code; the verifier never reviews":

| Role | Status | Responsibility | Never does |
| --- | --- | --- | --- |
| **app-cartographer** | **new** (coding capability) | Owns the site-map workflow end-to-end: orchestrates stages, does modeling judgment (S2/S3), assembles, narrates the receipt | Verify its own claims; author journeys' business framing |
| **journey-designer** | **new** (coding) | S4/S7: propose, cap, rank, and shepherd journeys through curation; guard the arc42 few-important-journeys discipline | Touch the graph layers; confirm its own proposals (humans do) |
| **verifier** | reused | Run S6 Tier-A deterministic gates in order, stop on first blocking failure, preserve evidence | Subjective review |
| **adversarial-reviewer** | reused | S6 Tier-B: refute sampled claims, anchored to the machine-built evidence digest | Author or fix the map |
| **gap-detector** | reused | Bidirectional reality check: surfaces in code missing from map, map entries with no code — plus untested-journey gaps later | Decide severity alone (findings flow to triage) |
| **doc-maintainer** | reused | The feature-development-time maintainer path (§III): differential map patches when diffs touch flow-relevant files | Full re-mapping (that's a workflow run) |

Each new role file follows the fixed skeleton (Purpose / Model / Tools / Inputs / numbered Instructions / fenced Output Contract with closed vocabularies), including the house rule: *"Every finding must include a concrete fix. 'Review this' is not a fix."*

### II.6 Verification design (how we know the map is TRUE)

The framework has **no random-sampling precedent, deliberately** — its philosophy is deterministic, exhaustive, reproducible. The verification stage honors that:

- **Tier A — exhaustive, script-only, zero tokens** (SCRIPT-ENFORCED):
  1. Schema + cross-reference integrity (every transition target exists; every guard referenced is defined; module slugs exist in the module map).
  2. **Evidence resolution**: every `file:line` cited anywhere in the map resolves — file exists, line in range, cited symbol/text present. One wrong line poisons trust in the whole artifact, so this check is total, not sampled.
  3. **Extraction coverage**: every extracted surface is mapped or explicitly excluded with a reason; extraction fingerprint matches the map's recorded baseline (zero unexplained drift).
  4. Graph invariants: reachability from entries, dead-end inventory, guard-less sensitive-surface scan — computed, recorded as findings.
  5. Confidence budget: share of low-confidence elements above threshold ⇒ escalation (`ask`), not silent pass.
  6. Per-claim proof samples: the **first N (deterministic)** concrete references recorded as evidence per surface — stable across runs, so retests re-verify the same proofs.
- **Tier B — bounded LLM re-derivation** (AGENT-RAISED → DECISION-PAUSE-ENFORCED): only for claims Tier A marks *inconclusive* (semantic claims scripts can't check — "this redirect fires when the cart is empty"), plus **all** auth/role guard edges (the highest-risk class). Selection is **deterministic** (all guards + first-N per area, ordered by the run's subject digest — reproducible, retestable). The reviewer's posture is **assume-wrong-first** (the flaky-judgment bias, inverted for claims): a claim survives only if the evidence supports it; the ambiguous middle goes to a Decision Pause rather than auto-resolving. The computed verdict **overrides the model's declared confidence** (the reuse-verification precedent).
- **Grading honesty**: Tier A results are graded `deterministic`, Tier B `llm-judged`, anything unestablished `blocked` — flattening those tiers is "exactly the theater the receipt exists to prevent," and the receipt keeps them separate.

### II.7 The fine-grained skill catalog (one skill = one job)

All follow the meta-tested folder contract — `SKILL.md` (fixed section order, <500 lines) + `references/` (judgment guidance) + `assets/` (output templates, closed vocabularies — no logic) + `scripts/` (one verb each, `--help`, exit 0/1/2, portable) + `agents/openai.yaml` — and the house pattern **script finds → LLM judges → script grades** (every skill's output must pass its own `lint-output.sh`).

| # | Skill | Stage | One job | Its scripts (pre-scan / linter) | Model tier |
| --- | --- | --- | --- | --- | --- |
| 1 | `site-map-readiness` | S0 | Derive the readiness tier and route the `missing` case | `derive-tier.sh` (pure function of counts), `check-prereqs.sh` | fast |
| 2 | `surface-extraction` | S1 | Run extractors, normalize, fingerprint | `run-extractors.sh`, `normalize.sh`, `validate-extraction.sh` | fast (mostly no LLM) |
| 3 | `surface-modeling` | S2 | Name/slug/type surfaces; attribute modules; mark entries/exits | `lint-slugs.sh`, `check-evidence.sh`, `check-accounting.sh` | reasoning |
| 4 | `transition-tracing` | S3 | Find and evidence transitions only | `candidates-scan.sh` (grep for nav/link/redirect sinks), `lint-transitions.sh` | reasoning |
| 5 | `guard-inference` | S3 | Find and evidence guards + `satisfy_via` only | `guard-scan.sh` (middleware/decorators/meta), `lint-guards.sh` | reasoning |
| 6 | `journey-synthesis` | S4 | Propose capped, well-formed journeys only | `hints-digest.sh` (tests/analytics/readme), `lint-journey.sh` | reasoning |
| 7 | `site-map-assembly` | S5 | Drive the compile verb; resolve merge conflicts with locked content | (verb-backed) `crossref-check.sh` | fast |
| 8 | `map-verification` | S6 | Tier-B refutation of script-inconclusive claims | `digest-claims.sh` (machine-built claim table), `lint-verdicts.sh` | reasoning |
| 9 | `site-map-gap-analysis` | S6→S8 | Turn invariants + verdicts into `SM-*` findings and the gap report | `compute-gaps.sh`, `format-report.sh` | medium |
| 10 | `site-map-publication` | S8 | Curate the token-budgeted index + overview narrative (prose only; views are generated) | `gen-views.sh` (Mermaid/index/user-flows), `lint-output.sh` (budget + headings) | medium |
| 11 | `site-map-maintainer` | feature-dev | Differential map patch when a diff touches flow-relevant files (§III) | `detect-stale-map.sh` (fingerprint diff), `patch-scope.sh` | medium |
| 12 | `site-map-retest` | retest | Replay findings/claims by stable ID; never invent, never lower severity, never call absence "fixed" | `load-source-findings.sh`, `lint-output.sh` (id validation) | reasoning |

Reused as-is: `finding-normalizer` (gains the `SM-` prefix + `site-map` trigger), `existing-doc-checker`, the `decision` skill, and the adversarial-review evidence-digest pattern. Phase 4 adds a 13th skill, `journey-test-linkage`.

Frontmatter discipline: all evidence skills `cacheable: false`; `triggers: [{workflow: [site-map]}]` (retest variants on their own workflow); typed `input_schema`; explicit anti-false-positive stop conditions in every SKILL.md ("do not flag a transition merely because a link exists — only when evidence shows navigation actually occurs").

---

## Part III — Feature-development integration (the map stays alive)

Once the capability exists, the user story is: *feature development already updates the documentation — now it updates the map too.* Concretely:

1. **Stale detection during any code change**: the stale-doc detector and diff-doc-sync scripts learn the flow-relevant path globs (per pack: `routes/**`, controllers, `pages/**`, navigation dirs, `src/cli/**`); the documentation-sync engine's routing table gains a `sitemap → site-map-maintainer` row. During `documentation_sync`, a diff touching those paths raises the map as a stale target — same contract as `api-doc-maintainer` today.
2. **The maintainer patches differentially** (doc-maintainer's rule: a 3-line patch beats regenerating a 200-line file): update the affected surfaces/transitions/guards + their evidence, bump the fingerprint, regenerate only affected projections. **Guard changes always escalate** (a removed auth middleware is `SM-GUARD-DRIFT`, security-relevant → Decision Pause), mirroring design-system-sync's never-auto-apply posture.
3. **A `SiteMapFreshnessGate`** joins the verification gate registry with honest tiering: the **extraction layer is genuinely SCRIPT-ENFORCED** (re-run extractors on changed files, compare fingerprints — deterministic, unlike stale-docs judgment), while semantic staleness (renamed journey intent) stays AGENT-RAISED → DECISION-PAUSE-ENFORCED. Inconclusive grades `blocked`, never pass.
4. **Cross-artifact joins**: extraction backfills the module map's dormant `evidence.routes` field; module-map reconcile and site-map reconcile cross-reference (`MM-*` ↔ `SM-*`); the stage classifier learns that edits under the map's home record as `documentation_sync`.
5. **Routing registration** (four places): workflow-router frontmatter + `routing-rules.txt` rows — proposed band: `site-map-retest 233`, `site-map 232` (between root-cause-analysis 230 and design-test 235; retest above base so "retest the site map" can't match "site map") — + the rules files with matching `## Trigger` phrases + `CLASSIFICATION_WORKFLOWS`. Honesty note: the phrase table and rules file are what make routing *work* (design-test routes today while absent from `CLASSIFICATION_WORKFLOWS` — an existing gap); the classification union governs how the engine records and validates the routed workflow, and site-map must not copy that gap. The bootstrap's numbered workflow list grows to 11 (+retest backing), regenerated via its writer.
6. **Capability gating**: one `site_map` flag in the framework-config registry (env `PAQAD_SITE_MAP`), requiring the `coding` capability. **Footprint policy** (design-test's three-way contract): framework-owned (schema, stage registry, verification rules, verbs), project-tunable via declarative config only (journey cap, confidence thresholds, extractor overrides, strictness), off-limits (swapping framework skills, editing the workflow rule, hand-editing rigid artifacts).

---

## Part IV — Build phases (each ships standalone value; no code until this plan is approved)

| Phase | Ships | Skills/roles landing | Exit criteria |
| --- | --- | --- | --- |
| **P1 — The deterministic core + the graph** | Routed workflow + run bundle + verbs; stages S0–S3, S5, S6, S8-partial (map + index + overview, journeys empty); schema + validation; baseline; dashboard **basic** Site map area (district overview, layered canvas, search, detail panel with evidence links, trust header) | Skills 1–5, 7–9 (subset), 10; role `app-cartographer`; gate allowlist registration | A real project runs `create site map` end-to-end; every published element passes Tier-A verification; dogfooded on paqad-ai itself (a CLI — keeps the design honest beyond web apps) |
| **P2 — Journeys & the human layer** | S4 + S7 (curation via Approvals/decision packets); journey playback; first-run guided flow + checklist; per-module `user-flows/` pages; gap panel; list-view twin | Skill 6; role `journey-designer` | A newbie can complete the first-5-minutes flow on a mapped project; journeys confirmed through the audited surface |
| **P3 — Always in sync** | site-map-maintainer in `documentation_sync`; `SiteMapFreshnessGate`; stale-path wiring; `site-map-retest`; diff view ("changed since last visit"); `evidence.routes` backfill; pentest surface back-feed | Skills 11–12; doc-maintainer path | A feature-dev change touching routes cannot reach "Safe to merge" with a stale map; retest replays cleanly by stable ID |
| **P4 — Compounding consumers** | `journey-test-linkage` + untested-journeys report; regression-skeleton generation per journey; optional narrow query verbs (2–4) for large apps; analytics overlay; the measured flow-question token benchmark published | Skill 13 | Journey coverage visible in the receipt; benchmark numbers in `benchmarks/measured.md` before any README claim |

Per-phase engineering hygiene is the house standard and is assumed, not optional: 100% coverage, meta-tested skill folders, drift tests for every registry mirror, extension-surface entries for any new public API, self-maintenance docs (module map entry, registries, onboarded-overview), and a changeset per PR.

---

## Part V — Risks and honest edges

| Risk | Mitigation in this plan |
| --- | --- |
| LLM-authored map content drifts into "generated prose that hurts" (the ETH finding) | The LLM writes only non-inferable fields; everything it writes is evidence-anchored, linted, and Tier-A-verified; extraction facts are never LLM-authored |
| Verification theater | Two-tier grading kept separate in the receipt; inconclusive = blocked; deterministic selection so retests re-verify the same claims |
| Curation fatigue / journey sprawl | Hard cap + ranking in `journey-synthesis`; curation is batch-reviewed; map publishes independently of journey confirmation |
| Dynamic/imperative navigation resists static extraction | Confidence is a first-class, visible property; low-confidence edges are Tier-B work items and dashboard-flagged, never silent; optional runtime confirmation stays a P4+ idea |
| Stage classifier / gates misfiling the new artifacts | Explicitly listed touch points (classifier paths, instructions-area allowlist, gate registration) — each is a named checklist item, not a discovery |
| Two new roles bloat the role table | Only two, incentive-separated; verification and maintenance reuse existing roles |

---

## Part VI — Decisions for the owner (approve / adjust)

1. **Architecture**: two-layer (rule + deterministic verb driver), codebase-health engine pattern, workflow-template engine not the execution path. *(Recommended: yes — it is the only pattern the framework's own precedents support.)*
2. **Stage registry**: the ten stages of §II.3, all mandatory, with `refresh`/`site-map-retest` bookends. *(Recommended as listed.)*
3. **Skill granularity**: 12 fine-grained skills + 1 in P4, per §II.7. *(Recommended; merging transition-tracing and guard-inference is the one defensible reduction if 12 feels heavy — at the cost of blurring two failure classes.)*
4. **Agents**: two new roles (`app-cartographer`, `journey-designer`) + four reused. *(Recommended; a third new role for verification is possible but reuse keeps incentives clean and the role table small.)*
5. **Artifact homes**: canonical map + index at `docs/instructions/site-map/` (allowlist-registered), run reports at `docs/site-map/`, run bundles + baseline under `.paqad/site-map/`. *(Recommended.)*
6. **Routing**: trigger `create site map` (+ variants), priorities retest 233 / base 232. *(Recommended.)*
7. **LLM delivery**: `index.md` joins the bootstrap always-load contract when the flag is on, with the explicit consult-and-verify trigger rule (the 160x effect); full map stays just-in-time; query verbs deferred to P4. *(Recommended.)*
8. **Curation surface**: dashboard Approvals + decision packets as the journey-confirmation path. *(Recommended.)*
9. **Flag default**: `site_map` OFF through P1–P2, ON by default once P3 sync ships. *(Recommended — this deliberately changes the proposal's decision 5, which flipped ON at Phase 1; sync-gated ON is safer because a map without its freshness gate can silently go stale.)*
10. **Naming**: area/trigger "Site map", artifacts `app-map.yaml` + `journeys/`. *(Carried from the proposal; confirm.)*

On approval, the next step is the standard house process: freeze a feature spec per phase (P1 first) with acceptance criteria and invariants, then build inside the feature-development workflow — this plan is the input to that spec, not a bypass of it.
