---
'paqad-ai': minor
---

The spec pipeline, its expert panel and strict adoption are now on by default (#640). On the next update, a project that never set these keys gets all three on the graduated and full lanes: the specification stage runs `paqad-ai spec pipeline`, the four standing experts (product owner, application architect, user-flow writer, QA engineer) sit at every spec, and a hand-written spec freezes only with `--manual --reason "<why>"`, which is recorded. The fast lane is unchanged: no pipeline run, no experts and no extra bundle files.

A change that is already open when you update keeps going as it was. If its spec was frozen before the update, it is not asked for the pipeline's files (`request.md`, `clarification.json`, `experts.json`) or for a pipeline record on the spec, and the completion check says so: "Spec frozen before the spec pipeline was on, so not required". If its spec is not frozen yet, it goes through the pipeline like any new change.

A project that already set any of these keys keeps its value. `paqad-ai update` never writes the new defaults into a config file.

Cost: the standing experts carry about 24k tokens of budget per spec, under a 40k ceiling by default. `paqad-ai doctor` now shows each setting and where its value came from.

To switch any of them off, add a line to `.paqad/configs/.config.*` (for the whole team) or `.paqad/.config` (just for you), or set the matching `PAQAD_*` environment variable:

- `spec_pipeline_enabled=false` turns the whole pipeline off (`PAQAD_SPEC_PIPELINE_ENABLED=false`)
- `spec_pipeline_experts_enabled=false` keeps the pipeline but drops the experts (`PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED=false`)
- `spec_pipeline_adoption=warn` lets a hand-written spec freeze again (`PAQAD_SPEC_PIPELINE_ADOPTION=warn`)
