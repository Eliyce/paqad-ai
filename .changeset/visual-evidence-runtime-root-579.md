---
'paqad-ai': minor
---

Visual evidence now actually runs from the Stop hook, and a frontend change hears about it at every stage (#579).

- **The gate fires again.** The Stop hook loads `dist/index.js`, one folder shallower than the CLI, and the package root was worked out with a fixed `../..`. From there it pointed one folder too high, no stack packs loaded, and every change read as "not frontend". paqad now walks up to its own `package.json`, so every bundle finds the same runtime folder. A new end-to-end test runs the built bundles and the real Stop-hook script to keep it that way.
- **A broken install says so.** If your profile names frameworks but paqad loads none of its packs, the visual-evidence gate reports an install fault (fail under strict, inconclusive under warn) and `visual-evidence run` / `plan` exit 1, instead of quietly passing the change.
- **New: `paqad-ai visual-evidence attach <png...> [--ac AC-3] [--label "..."]`.** When a scripted capture cannot run here, attach your own PNG screenshots. They are hashed and recorded as agent-attached (never shown as scripted captures), and a later `visual-evidence run` keeps them.
- **Strict mode is stricter.** Under `visual_evidence_mode=strict`, a frontend change with nothing captured because there is no documented flow or capture script now fails. Attach screenshots, or record a waiver by answering the readiness decision with `waive` (the gate then reads skipped, never pass). Warn mode is unchanged and now prints a "⚪ visual evidence: skipped (reason)" line.
- **Asked for earlier.** `plan compile` opens one decision pause when the change is frontend and this machine cannot capture screenshots yet (plan steps can now list the `files` they touch). `spec freeze` asks for at least one `(proof: visual)` criterion on a frontend change. The first frontend edit carries a one-time reminder to the model.
- **On the record.** The late gates (bundle-completeness, visual-evidence, rules-loaded) are now written to the bundle's `evidence.jsonl` when the evidence ledger is on, skips included, with a new `skipped` verdict that never counts as a pass or a fail.
