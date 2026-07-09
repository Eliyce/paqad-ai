# Spec — S-326 Truth tooling

## Behavior
Two small commands that make the framework honest and self-explaining: `paqad-ai
config effective` prints, per knob, the value that actually binds, the surface it came
from, and the gate that consumes it (exposing placebos); and `paqad-ai decision
create|resolve|list` is a real, install-resolved CLI verb for the Decision Pause
Contract, replacing the broken `node runtime/base/...` path that ENOENTs in onboarded
projects.

## Acceptance criteria
- **AC-1** (config effective): given a project, `paqad-ai config effective` prints every
  `FRAMEWORK_CONFIG_SPECS` knob with its effective value, source surface, and consumer;
  a verified-unwired knob (e.g. `escalate_security_findings`) shows `consumed by:
  NOTHING`. It never mutates any config. `--json` emits the same data machine-readable.
- **AC-2** (config truth): given `rule_compliance`/`stages_mode`, the printed effective
  value reflects the real floored resolver (tracked/yaml stricter-of), and the consumer
  column names the gate that reads it.
- **AC-3** (decision create): `paqad-ai decision create --category finding.triage --title
  t --context c --option a=A --option b=B` works in an onboarded project (not just the
  dev repo), mints a `D-<ULID>`, and writes `.paqad/decisions/pending/`. It wraps the
  existing engine (no hand-authored JSON, no forked format).
- **AC-4** (category validation): an unknown `--category` is rejected with a nearest-match
  suggestion; a valid category passes.
- **AC-5** (decision resolve + write-in): `paqad-ai decision resolve <id> <chosen>
  [rationale]` moves the packet to `resolved/`; `--other "<text>"` mints a write-in
  option and resolves to it.
- **AC-6** (decision list): `paqad-ai decision list` shows pending and resolved packets.
- **AC-7** (contract text): the generated Decision Pause Contract instructs `npx paqad-ai
  decision ...`, not the `node runtime/base/...` path.

## Invariants
- **INV-1**: `config effective` is strictly read-only.
- **INV-2**: `decision` wraps `createPendingDecision`/`resolvePendingDecision` — the ULID
  mint and packet format are unchanged (a hand-picked sequential `D-{N}` stays rejected).
- **INV-3**: the consumer map is honest — `NOTHING` only for knobs verified to have no
  runtime consumer.
