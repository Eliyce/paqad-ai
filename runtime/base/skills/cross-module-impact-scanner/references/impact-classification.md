# Cross-Module Impact Classification

When a proposed change touches a module's public surface, classify the impact on every consuming module along these dimensions.

## Surface types

- **API contract** — HTTP endpoint, RPC method, message schema, library export
- **Event** — published or consumed bus events, webhooks
- **Schema** — database table, column, constraint, index
- **Configuration** — environment variable, feature flag, runtime setting
- **Shared utility** — function or class re-used across modules

## Impact severity

- **`breaking`** — consumers will fail at compile, deploy, or run time without coordinated change. Examples: removing a required request field, changing a response field type, deleting a published event.
- **`additive`** — consumers continue to work unchanged; new behavior is opt-in. Examples: adding an optional request field, adding a new event type, adding a non-required env var with a sensible default.
- **`silent-shift`** — consumers continue to compile and deploy but the runtime contract has shifted in a way they may not notice. Examples: changing a default value, narrowing an accepted range, reordering pagination, changing rate limits.
- **`internal-only`** — the change does not affect any other module. The scanner records this for completeness but does not warn.

## Decision rules

When in doubt between `breaking` and `silent-shift`, prefer `breaking`. Silent shifts are the most dangerous because consumers do not get a fail-fast signal at deploy time.

When the change is `additive` but ships with no documentation update, downgrade to `silent-shift` until the docs are updated — a behavior consumers cannot discover is effectively a silent shift.

## Coordination requirement

For each `breaking` or `silent-shift` impact, the report must list:

1. The consuming module(s) affected.
2. The minimum coordinated change required in each consumer.
3. Whether a deprecation window is feasible (i.e. ship the additive form first, retire the old form later).

When a deprecation window is not feasible, the change requires a Decision Packet under the Decision Pause Contract before merging.
