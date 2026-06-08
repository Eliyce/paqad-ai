# Engine Extension Surface Contract

Canonical enumeration of every engine API that a downstream consumer depends on,
with the stability guarantee that lets a breaking change be caught at design time
rather than at integration (PQD-92).

## How to read this document

- **Consumer** — who depends on the API (`cli`, a coding-agent adapter id, the
  `rule-scripts` subpath, `desktop`, the `api` layer, the `marketplace`). Entries
  for consumers that do not yet import the package are marked `(planned)`.
- **Engine module** — the source module that owns the symbol.
- **Symbol / Signature** — the exported name and its TypeScript shape. Type-only
  entries (`interface …`, `type …`) are erased at runtime; value entries
  (functions, consts) are reachable from a public entry point.
- **Stability** — one of `stable`, `beta`, `alpha`, `internal` (see
  `src/core/types/stability.ts`). `internal` symbols are **not** part of the
  surface and consumers must not depend on them.
- **Since** — the semver in which the entry was introduced.
- **Exempt** — a recorded reason that excludes the entry from the static
  orphan/drift checks (for call sites the static analysis cannot reach).

## Maintenance contract

- **Public entry points:** `src/index.ts`, `src/cli/index.ts`,
  `src/rule-scripts/index.ts`. A change to any of these without amending this
  document in the same change set is blocked by the `extension-surface`
  verification gate and by `pnpm run check:surface-drift` (AC2/AC3).
- **Orphans:** `pnpm run check:surface-orphans` reports every entry whose symbol
  no consumer references, with a recommendation to remove it or downgrade it to
  `internal` (AC4). Add an **Exempt** reason to silence a known false positive.
- The exhaustive per-symbol inventory of the `export *` barrels is enforced
  programmatically by those checks; this document records the depended-upon
  contract surface and the stability promise attached to each entry.

## Package identity (all consumers)

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| all | src/core/constants/index.ts | `VERSION` | `const VERSION: string` | stable | 1.0.0 | |
| all | src/core/constants/index.ts | `getFrameworkName` | `getFrameworkName(): string` | stable | 1.0.0 | |
| all | src/core/types/domain.ts | `SUPPORTED_DOMAINS` | `const SUPPORTED_DOMAINS: readonly string[]` | stable | 1.0.0 | |
| all | src/core/types/domain.ts | `SUPPORTED_STACKS` | `const SUPPORTED_STACKS: readonly string[]` | stable | 1.0.0 | |
| all | src/capabilities.ts | `SUPPORTED_CAPABILITIES` | `const SUPPORTED_CAPABILITIES: readonly string[]` | stable | 1.0.0 | |
| all | src/core/types/stability.ts | `STABILITY_LEVELS` | `const STABILITY_LEVELS: readonly string[]` | stable | 1.10.0 | |
| all | src/core/types/stability.ts | `StabilityLevel` | `type StabilityLevel (stable, beta, alpha, internal)` | stable | 1.10.0 | |
| all | src/core/types/stability.ts | `SurfaceEntry` | `interface SurfaceEntry { consumer; engineModule; functionSignature; stabilityLevel; since; exempt? }` | beta | 1.10.0 | |

## CLI consumer

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| cli | src/cli/index.ts | `runCli` | `runCli(argv?: string[]): Promise<void>` | stable | 1.0.0 | |
| cli | src/cli/index.ts | `getCliBanner` | `getCliBanner(): string` | stable | 1.0.0 | |
| cli | src/cli/index.ts | `shouldRunFromCommandLine` | `shouldRunFromCommandLine(importMetaUrl: string, argvEntry?: string): boolean` | stable | 1.0.0 | |
| cli | src/cli/index.ts | `argvToEntrypoint` | `argvToEntrypoint(value?: string): string` | beta | 1.0.0 | resolved from process.argv at runtime; not statically reachable |

## Coding-agent adapter consumers

The coding-agent adapters (`claude-code`, `codex-cli`, `cursor`, `gemini-cli`,
`junie`, `github-copilot`, `windsurf`, `continue`, `aider`, `antigravity`) are
selected dynamically by adapter type and implement a shared contract.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| adapters | src/core/types/adapter.ts | `ADAPTER_TYPES` | `const ADAPTER_TYPES: readonly string[]` | stable | 1.0.0 | |
| adapters | src/adapters/adapter.interface.ts | `AdapterInterface` | `interface AdapterInterface` | stable | 1.0.0 | implemented per-adapter; selected dynamically by adapter type |
| adapters | src/adapters/adapter.interface.ts | `AdapterCapabilities` | `interface AdapterCapabilities` | stable | 1.0.0 | |
| adapters | src/adapters/adapter.interface.ts | `GeneratedFile` | `interface GeneratedFile` | stable | 1.0.0 | |
| adapters | src/adapters/adapter.interface.ts | `AdapterContext` | `interface AdapterContext` | beta | 1.0.0 | |

## Rules-as-scripts subpath consumer

Consumed via `import 'paqad-ai/rule-scripts'` by the rules-as-scripts skill
wrappers (issue #89).

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| rule-scripts | src/rule-scripts/runner.ts | `runRuleScripts` | `runRuleScripts(opts: RunOptions): RunReport` | beta | 1.0.0 | |

## Verification consumers

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| api | src/core/types/verification.ts | `VERIFICATION_GATES` | `const VERIFICATION_GATES: readonly string[]` | stable | 1.0.0 | |
| api | src/core/types/verification.ts | `GateResult` | `interface GateResult { gate; passed; inconclusive?; detail; remediation? }` | stable | 1.0.0 | |
| api | src/core/types/verification.ts | `VerificationContext` | `interface VerificationContext` | beta | 1.0.0 | |

## Desktop consumers (planned)

The Electron desktop (`paqad-ai ui`) does not yet import this package. These are
the type surfaces it is expected to depend on once the engine bridge is wired;
they are listed so the UI team can commit to their stability grade.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned) | src/adapters/adapter.interface.ts | `AdapterCapabilities` | `interface AdapterCapabilities` | stable | 1.0.0 | planned consumer; no in-tree call site yet |
| desktop (planned) | src/core/types/verification.ts | `VerificationContext` | `interface VerificationContext` | beta | 1.0.0 | planned consumer; no in-tree call site yet |

## Engine event-stream consumers (planned)

The unified in-process event bus (PQD-99). The desktop forwards `EngineEvent`
payloads over its Electron IPC bridge; the API layer subscribes directly. The
bus class is reachable from the package root; the event/subscription types are
forwarded to the renderer untransformed (plain data, no class instances).

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned), api (planned) | src/event-bus/engine-event-bus.ts | `EngineEventBus` | `class EngineEventBus { subscribe(cb, filter?): Subscription; emit(event): void; unsubscribe(id): void }` | beta | 1.10.0 | |
| desktop (planned), api (planned) | src/event-bus/engine-event-bus.ts | `EngineEventBusOptions` | `interface EngineEventBusOptions { bufferSize?; neverDrop?; maxPayloadBytes? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `EngineEvent` | `type EngineEvent (discriminated union, kind + at)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `EngineEventKind` | `type EngineEventKind = EngineEvent['kind']` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `EngineEventFilter` | `interface EngineEventFilter { kinds: readonly EngineEventKind[] }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `Subscription` | `interface Subscription { id; state; unsubscribe(): void }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `EngineEventCallback` | `type EngineEventCallback = (event: EngineEvent) => void` | beta | 1.10.0 | planned consumer; no in-tree call site yet |

### Decision-pause events (PQD-101)

Decision events are multiplexed into the same `EngineEvent` stream so the
desktop's Decision Pause panel can react live without polling
`.paqad/decisions/pending/`. The `decision-paused`/`decision-resolved` variants
are enriched (additively); `decision-packet-corrupt`, `decision-cap-exceeded`,
and `decision-discarded` are new. `SliceExecutor` wires the emit calls; a
consumer drops a packet via `SliceExecutor.discardDecision(...)`.

| Consumer | Engine module | Symbol | Signature | Stability | Since | Exempt |
| --- | --- | --- | --- | --- | --- | --- |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionEventOption` | `interface DecisionEventOption { option_key; label; one_line_preview; trade_off; technical_detail? }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionPausedEvent` | `interface DecisionPausedEvent (kind: 'decision-paused'; decisionId; question?; options?; recommendation?; packetPath?; …)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionResolvedEvent` | `interface DecisionResolvedEvent (kind: 'decision-resolved'; decisionId; chosenOptionKey?; resolver?; intent?)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionPacketCorruptEvent` | `interface DecisionPacketCorruptEvent (kind: 'decision-packet-corrupt'; decisionId; reason)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionCapExceededEvent` | `interface DecisionCapExceededEvent (kind: 'decision-cap-exceeded'; pendingCount; cap)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/event-bus/types.ts | `DecisionDiscardedEvent` | `interface DecisionDiscardedEvent (kind: 'decision-discarded'; decisionId; reason)` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-events.ts | `DecisionPauseEvent` | `type DecisionPauseEvent = Extract<EngineEvent, { kind: DecisionPauseEventType }>` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-events.ts | `DecisionPauseEventType` | `type DecisionPauseEventType` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-events.ts | `DECISION_PAUSE_EVENT_TYPES` | `const DECISION_PAUSE_EVENT_TYPES: readonly DecisionPauseEventType[]` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-store.ts | `DecisionCapExceededError` | `class DecisionCapExceededError extends Error { pendingCount; cap }` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
| desktop (planned), api (planned) | src/planning/decision-store.ts | `MAX_PENDING_DECISIONS` | `const MAX_PENDING_DECISIONS: number` | beta | 1.10.0 | planned consumer; no in-tree call site yet |
