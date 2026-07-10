# Plan — #345 feature-dev contract delivery/enforcement + #343 per-feature evidence cutover

Branch: `fix/345-rule-fixes` (current). One PR. Small commits, each `pnpm run ci`-green.
Develop #345 first (branch is named for it), then #343. Do not break the feature-development stage spine.

## Verified current state (from code + the LIVE `.paqad/context/session-context.md`, 128 KB)

### #345
- **G1 delivery/ordering** — DONE in main: `runtime/hooks/agent-entry-prompt-gate.mjs` emits the load directive alone when cold, the `[paqad-context]` block into stdout (not a side file) when warm; rule slice leads. Remaining: the block is huge because of G2/G3, so it trips the host truncation banner. Fixing G2/G3 shrinks it; add an ordering guard test.
- **G2 bloat/dedup** — root cause found: `extractTriggerPatterns` (src/planning/rule-compiler.ts:142) has NO explicit `<!-- trigger: -->` in 41/41 rule docs, so it falls back to treating EVERY backtick span (incl. multi-line code-fence contents) as a trigger. That explodes the manifest lines and over-matches. Retrieval slices are already capped (5×1200) but `composeRetrievalSection` does not dedupe.
- **G3 corruption** — SAME root cause: junk multi-line/prose "triggers" are joined with `` `, ` `` in `manifestLine` → 161 corruption fragments in the live artifact (NOT fixed, contra one report).
- **G4 rule-scripts** — wiring exists + feature-dev-scoped; `rule-script-map.yml` now present (396 rules) but all `scripts: []`; unarmed case is a SILENT NO_OP.
- **G5 decision-pause** — self-arm OFF by default, env-gated, NOT feature-dev-scoped; no "decision-pause is active" reminder anywhere.
- **G6 exclusivity** — gating implemented (`compositionForRoute`), partially tested; no single test proving all non-feature-dev routes load no rules / no module docs / arm no pause / run no rule-scripts.

### #343
- **A1** — `spec freeze` dual-writes legacy sidecar + bundle `specification.json`; `spec-change-guard` still reads `readFrozenSpecs` (`.paqad/specs`). `readFeatureSpecification`/`writeFeatureSpecification` exist; `readAllFeatureSpecifications` does NOT.
- **A2** — 4 `.yaml` manifest readers still on `.paqad/specs`.
- **A3** — dashboard inventory counts `PLANNING_SPECS_DIR`.
- **A4/A5** — narration-contract-writer still emits `.paqad/plans/<change>.md`; `PLANNING_SPECS_DIR` constant live; repo `.paqad/specs` + `.paqad/plans` dirs hold dogfood files.
- **B** — `receipt`/`aiBom` bundle names reserved, never written; no per-feature projection; whole-project gating lives in run-repository-verification.ts.

## Work sequence (each = one small commit, ci-green)

### Phase 1 — #345 G2/G3 (the dogfooded failure; highest value)
1. **rule-compiler triggers**: rewrite `extractTriggerPatterns` — explicit directive wins; else strip fenced code blocks, extract inline-code spans, keep only PATH/GLOB-shaped tokens (single-line, path charset, carrying `/`, `*`, or a file-extension dot). No path-shaped candidate ⇒ `['**']` (safe over-include, never drop). Add unit tests incl. a backtick-heavy/code-fence doc.
2. **manifest hardening**: render trigger patterns so the literal `` `, ` `` sequence never appears (separate backtick spans, space-joined) and guarantee single-line. Add a round-trip test asserting a rule with backtick code spans composes with `grep -F '`, `'` == 0 and its code spans intact.
3. **retrieval dedupe**: dedupe assembled slices by (source_file, content) in `composeRetrievalSection`. Test.
4. Regenerate the repo artifact; assert corruption 0 + size drop.

### Phase 2 — #345 G4 / G6 / G5
5. **G4 unarmed-says-so**: when the map is absent/empty, the rule-scripts checks verdict SAYS SO (⚪ no rule-scripts armed) instead of silent NO_OP. Test.
6. **G6 exclusivity test**: one test table proving each non-feature-dev route composes no rule slice / no module-doc retrieval + rule-scripts NO_OP + no self-arm.
7. **G5 decision-pause**: feature-development-scoped default-on for the conservative self-arm (env can still force off), and inject a compact "decision-pause is active — these categories require a packet" reminder into the feature-development context. Never arms outside feature-development. Tests incl. exclusivity.

### Phase 3 — #343 A1 (frozen-spec reader repoint)
8. `readAllFeatureSpecifications(projectRoot)` projection (mirrors `readAllFeatureStageRows`).
9. Repoint `spec-change-guard` to the projection; round-trip test (freeze → move source → expect stale) with NO `.paqad/specs` sidecar.
10. Drop `writeFrozenSpec` from `spec freeze` (write ONLY `specification.json`); delete `frozen-spec-store.ts` once grep-clean.

### Phase 4 — #343 A2/A3/A4/A5 (retire specs/plans)
11. Repoint the 4 `.yaml` manifest readers to a bundle-backed store (or retire).
12. Dashboard inventory counts specs from feature dirs.
13. narration-contract-writer + feature-development.yaml name `plan compile`/`spec freeze` writing bundle files; drop `.paqad/plans`/`.paqad/specs` scaffolding.
14. Remove `PLANNING_SPECS_DIR` once unreferenced; delete repo `.paqad/plans` + `.paqad/specs`.

### Phase 5 — #343 B (per-feature receipt/ai-bom)
15. `projectFeatureAiBom` / `projectFeatureReceipt` in projections.ts (reuse buildAiBom/signReceipt on the feature's own rows); whole-project projection from the union of feature dirs + `_chat`; honour the same enterprise gating; wire into `audit export` + dashboard. Tests.

## Invariants / guardrails
- INV-1: No non-feature-development route ever composes rules, module-doc retrieval, rule-scripts, or a decision pause.
- INV-2: Omitting a rule that applies is a correctness failure — the trigger fix must never DROP a real path trigger; when unsure, over-include (`**`).
- INV-3: Persisted keys use posix (`pathe`), not `node:path`.
- INV-4: `src/stage-evidence/**` stays at its 100% floor; defensive catches covered deterministically.
- INV-5: `pnpm run ci` green (incl. Windows) at every commit; 95% branch coverage held.
