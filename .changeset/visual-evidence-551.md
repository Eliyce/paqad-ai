---
'paqad-ai': minor
---

feat(#551): PR visual evidence — screenshots of documented flows as feature-bundle evidence

When a feature-development change touches frontend files, paqad now captures ordered
screenshots of the documented user flows the change affects, pairs each with a
business-language caption, stores them in the feature's git-ignored evidence bundle
(latest-run-wins), assembles an overview GIF, and verifies the evidence at end-of-change
like any other bundle artifact. Everything at runtime is deterministic scripts — zero LLM
calls in the execution path.

Off by default. Turn it on with the new `visual_evidence` flag (env `PAQAD_VISUAL_EVIDENCE`);
`visual_evidence_mode` (`warn`|`strict`, floored) governs how firmly the gate enforces. With
the flag off, feature-development is byte-identical to before.

What is new when `visual_evidence` is on and a change is frontend-triggering:

- a stack-pack `visual_evidence.frontend_globs` trigger decides when a change is frontend;
- compiled capture scripts (`docs/site-map/journeys/<id>.capture.yaml`) derived from
  **confirmed** site-map journeys drive the capture;
- a paqad-provisioned Playwright + Chromium runtime under `~/.paqad-ai/ve-runtime/` (never a
  hard paqad dependency, never imported from the target project);
- per-step `image.png` + `caption.txt` and an `overview.gif` under the bundle's
  `screenshots/` subtree, with a bundle-integrity carve-out;
- a `visual-evidence` verification gate, receipt line, and `report.html` section;
- a `paqad-ai visual-evidence` CLI group (`run`, `plan`, `setup`).
