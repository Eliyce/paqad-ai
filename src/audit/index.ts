// Issue #121 — the SIEM exporter: read-only, local-first projection of the #118
// evidence ledger + tamper-evident receipt chain into OCSF / ECS / CEF / JSONL
// for the customer's own SIEM. No paqad-hosted endpoint.

export * from './types.js';
export * from './aggregate.js';
export * from './redact.js';
export * from './export.js';
export { toOcsf, toOcsfRecord, OCSF_SCHEMA_VERSION } from './formats/ocsf.js';
export { toEcs, toEcsRecord, ECS_VERSION } from './formats/ecs.js';
export { toCef, escapeCefHeader, escapeCefExtension } from './formats/cef.js';
