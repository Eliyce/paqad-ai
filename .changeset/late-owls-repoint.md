---
'paqad-ai': patch
---

Evidence-in-bundle cutover, Phase B (#468): re-point every evidence reader off the retired
session-ledger and top-level homes and onto the per-feature bundle projections. The Rule
Compliance collector reads findings from the bundle `rule-run.jsonl` (latest by `ts`) and
drift live from the `.cache/drift.json`; the Change Shape collector and `metrics report`
read the ts-sorted window of the bundle `change-metrics.jsonl`; the SIEM `audit export`
aggregate unions the bundle projections and projects attestation/evidence from per-feature
receipts; and the Trust panel (evidence feed, receipt feed, AI-BOM, attestation,
onboarding, inventory) projects from the bundle union via `projectAiBomFromFeatures` and new
per-feature receipt readers. The per-feature receipt now additionally carries the
authorship/compliance/reproducibility predicates the attestation surfaces read, so a bundle
receipt is a complete attestation record. The RAG session fold stays on the substrate in
this phase: its re-point is coupled to the prompt-seam writer and moves with it in Phase C.
No old-home write is removed and no path is retired — every old-home write still fires, so
rollback is a single revert. Phase C removes the old writes and adds the existence gates.
