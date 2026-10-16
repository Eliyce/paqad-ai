# Quality and Release

Proves the plugin behaves as specified and gets it to users: script and authoring tests, conversation eval scenarios with fixtures, CI and release workflows, and the manual per-host verification harness.

| | |
|---|---|
| Layer | build-and-delivery |
| Confidence | medium |
| Entry skill | none (build and delivery) |
| Depends on | [plugin-build](../../plugin-build/index/summary.md) |
| Used by | none |

## Features

| Feature | What it does | Docs |
|---|---|---|
| Script and authoring tests | Standard-library unit tests over every script, the build, the CI checks and the authoring rules, including the offline AC-20 parity harness | [business](../features/unit-tests/business.md), [technical](../features/unit-tests/technical.md) |
| Conversation eval scenarios | 56 declarative conversation scenarios plus the S2 ChatGPT and Codex parity scenarios (AC-20), a fictional paqad-documented repository and tracker and a code-only repository; the conversation scenarios are authored but not yet run, while the structural half of the parity scenarios runs offline in the unit suite | [business](../features/conversation-evals/business.md), [technical](../features/conversation-evals/technical.md) |
| CI and release workflows | Pull request checks (unit tests and deterministic build run today), nightly evals and release, the rest as labelled placeholders | [business](../features/ci-pipeline/business.md), [technical](../features/ci-pipeline/technical.md) |
| Manual host verification | Install steps and a verdict table per host for the open unknowns; every verdict is still pending | [business](../features/host-verification/business.md), [technical](../features/host-verification/technical.md) |

## Sources

| Path | Role |
|---|---|
| `tests/scripts/` | 18 unit test files |
| `tests/evals/scenarios/` | `s1.yml`, `s1b.yml`, `repo-selection.yml`, `evidence-rules.yml`, `generic-mode.yml`, `s2.yml`, `README.md` |
| `tests/evals/run_parity.py` | Offline AC-20 structural-parity harness |
| `tests/evals/fixture-repo/` | Fictional paqad-documented `docs/`, fixture tracker, invented code stubs (`app/`, `tests/`, `vendor/points-kit/`) and a root `Requirements.md` |
| `tests/evals/fixture-repo-code-only/` | Fictional repository with real code (`app/Bookings/`, `app/Reminders/`, `tests/`) and no paqad docs, for the code-only level |
| `.github/workflows/ci.yml` | Pull request checks |
| `.github/workflows/verify.yml` | Nightly conversation evals |
| `.github/workflows/release.yml` | Release |
| `.changeset/README.md` | Changeset placeholder |
| `hosts/claude.md`, `hosts/chatgpt.md`, `hosts/codex.md` | Manual install and verdict harness per host; not shipped |

## Requirements

- CI-1 to CI-11, CI-20: pull request checks (only CI-7, without coverage gate, and CI-8 run today).
- CI-12, CI-13: conversation evals (placeholders).
- CI-14, CI-15: release (placeholders).
- CI-18, CI-19: post-release smoke test and per-host support state (harness exists, no verdicts).
- PLG-6: checklist fallback asserted for every script-bearing skill.
- PLG-7: host setup documented for people in `hosts/*.md`, not in skills.
- Section 13 acceptance scenarios: script-proven ones in the unit suite, conversation-shape ones in the eval scenarios.
