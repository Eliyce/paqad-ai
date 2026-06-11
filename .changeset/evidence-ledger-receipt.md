---
'paqad-ai': minor
---

Add the unified evidence ledger and a signed, gradeable per-change provenance receipt (issue #118).

Every verification gate (and quality-ratchet measure) now fans into one append-only ledger at `.paqad/ledger/evidence.jsonl`, and the merge-time backstop projects a per-change receipt from it: an in-toto Statement (v1) with a SLSA-VSA-modelled predicate, wrapped in a DSSE envelope and tamper-evident hash-chained locally (`.paqad/ledger/receipt.dsse.json` + `receipts.jsonl`), plus a CycloneDX-adjacent AI-BOM view (`.paqad/ledger/ai-bom.json`). The anti-"provenance-theater" rule is enforced end to end: every row is graded by evidence strength — deterministic (Tier A) vs LLM-judged (Tier B) vs blocked/inconclusive (Tier C) — so a computed pass is never pooled with a model's say-so. Ledger/receipt failures never block verification.
