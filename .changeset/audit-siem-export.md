---
'paqad-ai': minor
---

Add `paqad-ai audit export` — a read-only, local-first exporter that projects the
unified evidence ledger and tamper-evident receipt chain (#118/#120) into the
SIEM schemas enterprises already ingest: OCSF (primary), Elastic ECS, ArcSight
CEF, and a canonical JSONL passthrough.

`paqad-ai audit export --format=ocsf|ecs|cef|jsonl [--since <iso>] [--out <file>] [--redact]`
reads the on-disk ledger, normalizes each graded verdict and signed attestation
(verdict, deterministic-vs-LLM-judged grade, change-subject digests, chain seal
status, and change authorship) into the target schema, and writes a file or
stdout for the customer's own collector (Splunk forwarder, rsyslog, Datadog
agent, Filebeat) to ship. There is no paqad-hosted endpoint — their backend, our
data. `--redact` strips free-text detail and human identities for a lower-PII
export.
