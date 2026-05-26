---
'paqad-ai': patch
---

Fix `paqad-ai onboard` hanging on the RAG "No, skip" path at the end of the full interactive prompt chain.

The orchestrator previously interleaved the RAG inquirer prompt with file writes: `resolveRagSelection()` ran early, and `writeDetectionReport` / `writeFrameworkMetadata` / `writeOnboardingManifest` / `writeDecisionPauseContractDocument` / `compileRules` / `initializeModuleHealth` / `classifier-config.json` / `next-steps.md` all ran _after_ it. When inquirer left a stuck readline handle on Node's event loop — observed reliably with the full prompt chain on the No-skip branch — every post-RAG write was silently dropped. Users were left with an incomplete `.paqad/**` and no `ONBOARDING COMPLETE` banner.

Onboarding is now two-phase. Phase 1 writes every core `.paqad/**` artifact and `CLAUDE.md`-equivalents with no inquirer prompts in the path. The new `onPhase1Complete` callback fires only after the onboarding manifest is on disk, so the success banner prints before phase 2 begins. Phase 2 owns the RAG opt-in (prompt → optional index build → idempotent `writeProjectProfile` update). If phase 2 prompts, hangs, fails, or is interrupted, every phase 1 artifact is already durable on disk.

Adds three orchestrator invariant unit tests that pin the new contract (`onPhase1Complete` fires after all core artifacts exist; a thrown `RagService.configureAndBuild` does not drop core writes; a thrown `resolveRagSelection` does not drop core writes) and a PTY-driven E2E (gated on the system `expect(1)` binary, skipped on platforms without it) that drives the real built CLI through the full interactive Laravel prompt chain, picks "No, skip" on RAG, and asserts the complete `.paqad/**` artifact set on disk.

Closes #62.
