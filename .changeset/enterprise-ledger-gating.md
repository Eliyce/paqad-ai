---
'paqad-ai': minor
---

Gate the evidence ledger behind an opt-in `enterprise` config block (disabled by default).

`.paqad/ledger/` machinery (`evidence.jsonl`, `receipts.jsonl`, `receipt.dsse.json`, `ai-bom.json`) and the token-spending compliance-citation resolution now only run when a project opts in via `enterprise:` in `.paqad/project-profile.yaml`. With the block absent — the default for every existing and new project — a verification run writes no ledger files and resolves no citations, so a normal user pays zero tokens and gets a clean working tree.

```yaml
enterprise:
  enabled: false # master switch; when false every sub-flag is forced off
  evidence_ledger: false # evidence.jsonl + receipts.jsonl + receipt.dsse.json
  ai_bom: false # ai-bom.json (CycloneDX); independent of evidence_ledger
  compliance_citations: false # framework citations baked into the receipt
```

`enabled: true` turns the sub-flags into independent switches (e.g. AI-BOM without the full receipt set). The new `src/core/enterprise-policy.ts` resolver is the single seam a future license/token check slots behind. Onboarding only adds `.paqad/ledger/` to the managed `.gitignore` when the ledger is enabled. Verification verdicts are unaffected — ledger failures remain warnings, never blocks.
