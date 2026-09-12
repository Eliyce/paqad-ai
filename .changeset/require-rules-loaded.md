---
'paqad-ai': minor
---

Require and evidence rule-loading for feature-development changes (#557).

paqad enforced that the process ceremony ran (plan, spec, review, checks) but never that the
project's rules were actually loaded — so an agent could complete a fully green change with
every non-scripted rule unread, and code written on a non-feature route loaded no rules at
all. Rule-loading is now a required, deterministic (no-LLM) part of any feature-development
code change:

- **`paqad-ai rules load`** prints the full text of the rules that apply to your changed
  files and writes `rules-loaded.json` into the feature bundle (which rules apply to which
  files, plus a content hash of the loaded text). It works on any route.
- **Edit-time:** a new `rules-loaded` kernel capability blocks the first feature-dev source
  edit until that record exists — catching code written on a non-feature route at edit time.
- **Completion:** a new gate fails a feature-dev change whose applicable rules were never
  loaded (the same way a missing plan or spec fails) and reads Inconclusive when the load is
  stale.

No new config knob — rule-loading is required, gated only by paqad being enabled and the
change being feature-development. The record attests that rules were loaded and acknowledged,
not that they were comprehended.
