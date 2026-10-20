# Audit Export Command

> **Layer:** `cli-commands` &nbsp;·&nbsp; **Confidence:** `high` &nbsp;·&nbsp; **Slug:** `cli-audit`

## Purpose

Give enterprises the AI-code audit trail without paqad becoming a SaaS. A
read-only, local-first exporter that projects the unified evidence ledger and
the tamper-evident receipt chain (issues #118 / #120) into the SIEM schemas a
security team already ingests — then hands the result to **their** collector.
There is no paqad-hosted control plane, stream, or endpoint: paqad reads the
on-disk ledger and writes a standard-format file or stdout. Their backend, our
data.

## Command

```
paqad-ai audit export [--format ocsf|ecs|cef|jsonl] [--since <iso>] [--out <file>] [--redact]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--format` | `ocsf` | Target schema: OCSF (vendor-neutral, primary), Elastic ECS, ArcSight CEF, or canonical JSONL passthrough. |
| `--since` | — | Only export events at or after this ISO-8601 instant. |
| `--out` | stdout | Write to a file for a collector to ship; otherwise stream to stdout. |
| `--redact` | off | Replace free-text detail and human identities with `[REDACTED]`. |

### Pipe to your own collector

```
# Splunk / Datadog / Elastic: write NDJSON for the agent to pick up
paqad-ai audit export --format ocsf --out /var/log/paqad/evidence.ocsf.ndjson

# ArcSight / QRadar: one CEF line per event, straight to syslog
paqad-ai audit export --format cef | logger -t paqad
```

## What an event carries

Each emitted record is structurally richer than a hosted vendor log that omits
local session context, because it is projected from paqad's own ledger:

- **Evidence rows** — one per graded verification verdict: gate/finding `code`,
  `verdict`, the deterministic-vs-LLM-judged strength grade, the change-subject
  digest, and the content-hash dedup key. OCSF, ECS and CEF grade a verdict the same way
  (`src/audit/severity.ts`): a fail or blocked row is a finding, a pass is informational, and so
  is a `skipped` row (a gate that did not apply to the change, issue #579), which reads OCSF
  severity 1 and CEF severity 1 rather than unknown.
- **Attestation events** — one per receipt: `PASSED`/`FAILED`, the hash-chain
  **seal status**, the signing mode, the attested file digests, and the #120
  change authorship (agent, declared model/provider, accepting human).

## Why the code works the way it does

The reasons below are not obvious from the code in `src/audit/`.

- **`aggregate.ts`.** It reads the unified evidence ledger rather than reconciling the three older
  logs (`audit.log`, `decisions/audit.jsonl`, `skills/events.jsonl`), which are inconsistent in
  format; the ledger is already graded and content-addressed, so this is less code and richer
  evidence. Each feature bundle has its own receipt, so each one is checked on its own with
  `verifyReceiptSeal` and `sealed` reflects that check. The always-on session ledger (decision
  lifecycle, delivery detection, the disabled-session audit, health and site-map runs) is folded
  in so a security team sees the same feed as the dashboard; stage evidence, rule runs and
  change metrics are read from the bundles. A failed or blocking session row becomes a graded
  finding, a lifecycle row is informational. A bundle row's time is `recorded_at`, a session row's
  is `ts`. Events sort oldest first and an unreadable time sorts to the front.
- **`export.ts`.** Pure string in, string out; the CLI owns the file and stdout. With `--since`, an
  event whose time cannot be read is dropped, since it cannot be shown to be in range.
- **Formats.** OCSF records use the Application Activity class with activity "Unknown" (paqad events
  are not create, read, update or delete actions) and put the graded fields, which OCSF has no slot
  for, under `unmapped`. ECS fills `file` only when exactly one file changed (it holds one object);
  otherwise the digests go in `related.hash`, and paqad grades go in `labels.*` as strings. CEF is
  flat, so values are fitted into `cs1`..`cs6` and standard keys, with the spec's escaping (header:
  `\` and `|`; extension: `\`, `=` and newlines), the doc type as the producing service and the
  session id as the correlation id. The schema versions are pinned.
- **`redact.ts`.** Only free-text detail and the accepting human are replaced; verdicts, digests,
  hashes and grades identify no one and are kept, so a redacted export is still evidence.

## Source Footprint

- `src/cli/commands/audit.ts` — the `audit export` command.
- `src/audit` — aggregator, formatters (OCSF / ECS / CEF / JSONL), redaction,
  and the export orchestrator.
- Reads `src/evidence` ledger + receipt readers (no writes, no mutation).

## Boundaries

This module **owns** a read-only transform over the existing on-disk ledger. It
does **not** build a hosted control plane, a streaming service, a paqad-owned
endpoint, or a direct network push — doing so would break local-first and turn
paqad into a SaaS. Egress is the customer's collector's job.

## Authority

The single source of truth for this module's identity, slug, and source paths is
[`docs/instructions/rules/module-map.yml`](../../../instructions/rules/module-map.yml).
If anything here disagrees with the map, the **map wins** — update the map first,
then regenerate this page via `create module documentation`.

## Related

- Evidence ledger + receipts: issue #118 (`src/evidence`).
- Dashboard Trust area (view + PR-comment export of the same ledger): `src/dashboard/trust.ts`.
- Stack overview: [`docs/instructions/stack/overview.md`](../../../instructions/stack/overview.md)
