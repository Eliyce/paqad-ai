export const PATHS = {
  AGENCY_DIR: '.paqad',
  AGENCY_CACHE_DIR: '.paqad/cache',
  AGENCY_SESSION_DIR: '.paqad/session',
  PROJECT_PROFILE: '.paqad/project-profile.yaml',
  // Laravel-style framework config — four surfaces (precedence low→high, LOCAL
  // WINS): code defaults (`DEFAULT_FRAMEWORK_CONFIG`) < `configs/.config.*`
  // (tracked, team-shared, merged) < `.config` (git-ignored, dev-local) <
  // `PAQAD_*` env. Onboarding writes one self-documenting `configs/.config.*` file
  // per group (every knob commented at its default) plus a single `.config.example`
  // catalog of every knob — a copy-paste reference that is NEVER read at runtime.
  // Framework knobs (paqad/enterprise/RAG/strictness/escalation/features/research/
  // model_routing/decisions + version/update) resolve through these, not the profile.
  PROJECT_CONFIG: '.paqad/.config',
  PROJECT_CONFIG_EXAMPLE: '.paqad/.config.example',
  PROJECT_CONFIGS_DIR: '.paqad/configs',
  PROJECT_CONFIGS_README: '.paqad/configs/README.md',
  DETECTION_REPORT: '.paqad/detection-report.json',
  ONBOARDING_MANIFEST: '.paqad/onboarding-manifest.json',
  RAG_IGNORE_CONFIG: '.paqad/rag.ignore.yaml',
  STACK_DRIFT: '.paqad/stack-drift.json',
  STACK_SNAPSHOT: '.paqad/stack-snapshot.json',
  // Issue #42 — delivery-convention detection results (host/base/branch/commit
  // inferred from git history). Overlaid onto the delivery-policy `auto`
  // sections; the commented delivery-policy.yaml is never rewritten.
  DELIVERY_DETECTION: '.paqad/delivery-detection.json',
  DELIVERY_PR_BODY_TEMPLATE: '.paqad/templates/pr-body.md',
  FRAMEWORK_VERSION: '.paqad/framework-version.txt',
  FRAMEWORK_PATH: '.paqad/framework-path.txt',
  GLOSSARY: '.paqad/glossary.md',
  HANDOFF: '.paqad/session/handoff.md',
  CHANGED_FILES: '.paqad/session/changed-files.json',
  ACTIVE_IMPLEMENTATION_SESSION: '.paqad/session/active-implementation.json',
  CONTEXT_HIT_LOG: '.paqad/session/context-hit-log.json',
  PROJECT_QUESTION_ANSWER: '.paqad/session/project-question-answer.json',
  AUDIT_LOG: '.paqad/audit.log',
  DECISIONS_DIR: '.paqad/decisions',
  DECISIONS_PENDING_DIR: '.paqad/decisions/pending',
  DECISIONS_RESOLVED_DIR: '.paqad/decisions/resolved',
  DECISIONS_EXPIRED_DIR: '.paqad/decisions/expired',
  DECISIONS_INDEX: '.paqad/decisions/index.json',
  DECISIONS_AUDIT_LOG: '.paqad/decisions/audit.jsonl',
  // PQD-101 — JSONL fallback channel for decision-pause events (mirrors
  // MODULE_MAP_EVENTS_LOG). The in-process EngineEventBus is the live delivery
  // channel; this path supports future SSE/HTTP consumers.
  DECISIONS_EVENTS_LOG: '.paqad/decisions/events.jsonl',
  DECISIONS_LOCK: '.paqad/decisions/.lock',
  DECISION_PAUSE_CONTRACT: '.paqad/decision-pause-contract.md',
  // Issue #158 — canonical, managed narration contract: the full spec for how
  // paqad speaks in the live agent chat (voice, cadence, status-block format,
  // glyph vocabulary, plain-English term translations). A lean copy of the
  // operative rules is rendered into each provider entry file; this is the
  // single source of truth they point at.
  NARRATION_CONTRACT: '.paqad/narration-contract.md',
  // Feature 1 - Semantic Context Loader
  CHUNK_INDEX: '.paqad/context/chunk-index.json',
  LOAD_STATS: '.paqad/context/load-stats.json',
  VECTORS_DIR: '.paqad/vectors',
  VECTOR_INDEX: '.paqad/vectors/index.json',
  VECTOR_META: '.paqad/vectors/meta.json',
  // PQD-102 — vision-extracted text (OCR/caption) lives in a separate vector
  // index so a file-index rebuild never disturbs image-derived chunks and the
  // file-index provider/model match guard isn't conflated. Co-located in
  // .paqad/vectors so RagService.clear() (which removes the whole dir) clears
  // both file- and vision-derived content together.
  VISION_VECTOR_INDEX: '.paqad/vectors/vision-index.json',
  VISION_VECTOR_META: '.paqad/vectors/vision-meta.json',
  // PQD-415 — project-scoped CRS (Contextual Retrieval Store) collections. Each
  // named collection owns a directory under CRS_DIR keyed by its escaped id, with
  // its own `index.json` + `meta.json` mirroring the `.paqad/vectors/` layout.
  // Kept fully disjoint from VECTORS_DIR (project RAG) and the ephemeral
  // attachment collections so a CRS collection never disturbs either. Old indexes
  // are retained next to the live one under a `.revert.<ISO>` suffix for 24h after
  // a side-by-side reindex.
  CRS_DIR: '.paqad/crs',
  SECRETS_ENV: '.paqad/secrets.env',
  // PQD-174 — session-scoped ephemeral attachment collections for non-project
  // desktop conversations. Each session owns a directory keyed by its id under
  // SESSION_ATTACHMENT_COLLECTIONS_DIR; the registry maps live sessions to their
  // collections so the boot-time orphan sweep can purge any whose session is
  // gone. Kept fully disjoint from VECTORS_DIR (project RAG) and the pattern
  // vectors so an attachment collection never disturbs either.
  SESSION_ATTACHMENT_COLLECTIONS_DIR: '.paqad/attachments',
  SESSION_ATTACHMENT_REGISTRY: '.paqad/attachments/registry.json',
  // PQD-331 — append-only JSONL stream of attachment-indexing lifecycle events
  // (`attachment.indexed` / `attachment.index_failed` / `attachment.format_rejected`).
  // Kept separate from the RAG audit log so the desktop can tail just these to
  // badge an attachment's index state without parsing the broader audit stream.
  ATTACHMENT_EVENTS_LOG: '.paqad/attachment-events.jsonl',
  GLOBAL_PATTERN_VECTORS_DIR: '.paqad/patterns/vectors',
  GLOBAL_PATTERN_VECTOR_INDEX: '.paqad/patterns/vectors/index.json',
  GLOBAL_PATTERN_VECTOR_META: '.paqad/patterns/vectors/meta.json',
  // Feature 2 - Predictive Cache
  TRANSITION_LOG: '.paqad/cache/transition-log.json',
  CACHE_METRICS: '.paqad/cache/metrics.json',
  PLANNING_SPECS_DIR: '.paqad/specs',
  // Issue #103 - persisted regression guards (one sidecar per defect_id)
  REGRESSION_GUARDS_DIR: '.paqad/regression-guards',
  // Issue #106 - flaky-test registry / quarantine list
  FLAKY_TESTS_DIR: '.paqad/flaky-tests',
  FLAKY_REGISTRY: '.paqad/flaky-tests/registry.json',
  // Issue #107 - per-run finding triage ledger (four-pile sort + reasons)
  FINDINGS_DIR: '.paqad/findings',
  TRIAGE_LEDGER: '.paqad/findings/triage.json',
  // Issue #118 - unified append-only evidence ledger + the merge-time
  // provenance receipt (in-toto Statement / DSSE + CycloneDX AI-BOM) projected
  // from it. EVIDENCE_RECEIPT_CHAIN is the tamper-evident hash chain (one
  // envelope per line); EVIDENCE_RECEIPT/EVIDENCE_AI_BOM are the latest snapshots.
  EVIDENCE_LEDGER_DIR: '.paqad/ledger',
  EVIDENCE_LEDGER: '.paqad/ledger/evidence.jsonl',
  // Issue #249 - the lazily-minted, per-machine session id shared by the
  // session-scoped evidence ledgers (rag-evidence #249, stage-evidence #247) when
  // the host provides no session id of its own. `ses_<ulid>`, cached here.
  LEDGER_SESSION_ID: '.paqad/session/ledger-session-id',
  EVIDENCE_RECEIPT: '.paqad/ledger/receipt.dsse.json',
  EVIDENCE_RECEIPT_CHAIN: '.paqad/ledger/receipts.jsonl',
  EVIDENCE_AI_BOM: '.paqad/ledger/ai-bom.json',
  // Issue #123 - the latest reproducibility stamp (context hash of the frozen
  // materials the agent saw), read at receipt projection and folded into the
  // receipt as an input-replay claim.
  EVIDENCE_CONTEXT_STAMP: '.paqad/ledger/context-stamp.json',
  // Issue #109 - bidirectional traceability map (promise ↔ code ↔ test),
  // rebuilt from reality each run.
  TRACEABILITY_DIR: '.paqad/traceability',
  TRACEABILITY_MAP: '.paqad/traceability/map.json',
  // Issue #110 - quality-ratchet baseline (four measures at today's real level;
  // only ever tightens).
  QUALITY_BASELINE: '.paqad/quality-baseline.json',
  PLANNING_MODULE_HEALTH_DIR: '.paqad/module-health',
  MODULE_HEALTH_EVIDENCE_DIR: '.paqad/module-health-evidence',
  MODULE_HEALTH_CONSUMED_EVENTS: '.paqad/module-health-consumed-events.json',
  MODULE_HEALTH_LOCK: '.paqad/locks/module-health.lock',
  MODULE_HEALTH_LOG: '.paqad/logs/module-health.log',
  COMPILED_RULES: '.paqad/compiled-rules.json',
  PLANNING_COSTS: '.paqad/cache/planning-costs.json',
  // RAG buildout F2/F4 — the session-time injection seam's precomputed context
  // artifact. The runtime seam (runtime/scripts/context-seam.mjs) hardcodes the
  // same relative path; keep the two in sync.
  CONTEXT_SESSION_ARTIFACT: '.paqad/context/session-context.md',
  // RAG buildout F21 — the deterministic codebase-memory store (cross-session
  // repo facts, decisions, recurring failures, style). Lives under the already-
  // ignored crs/ root (per-machine, regenerable), disjoint from the desktop's
  // PQD-415 CRS collection subdirectories. A single JSON file, never a directory.
  CODEBASE_MEMORY: '.paqad/crs/codebase-memory.json',
  // RAG buildout F27 — base-drift awareness. The persisted drift snapshot (read on
  // the prompt path, no network), the debounce marker that floors the background
  // git fetch to one per interval, and its single-flight lock.
  BASE_DRIFT_STATE: '.paqad/session/base-drift.json',
  BASE_DRIFT_MARKER: '.paqad/session/base-drift.marker',
  BASE_DRIFT_LOCK: '.paqad/locks/base-drift.lock',
  // Feature 3 - Context Budget Optimizer
  CONTEXT_BUDGET_STATE: '.paqad/session/context-budget.json',
  CONTEXT_SAVINGS: '.paqad/session/context-savings.json',
  // QW-1 - Deduplication
  DEDUP_STATS: '.paqad/session/dedup-stats.json',
  // Feature 6 - Handoff Compression
  HANDOFF_JSON: '.paqad/session/handoff.json',
  HANDOFF_STATS: '.paqad/session/handoff-stats.json',
  // Feature 7 - Workflow Engine
  WORKFLOWS_DIR: 'docs/instructions/workflows',
  WORKFLOW_RUNS_DIR: '.paqad/workflows',
  SKILL_CACHE_DIR: '.paqad/cache/skill-results',
  SKILL_INDEX: '.paqad/skill-index.json',
  // PQD-194 — append-only JSONL audit trail of skill/pack registrations that
  // failed to load (malformed frontmatter, missing/invalid pack.yaml). Kept
  // separate from MODULE_MAP_EVENTS_LOG so skill concerns don't pollute the
  // module-map stream; the desktop tails this to badge a failed skill/pack and
  // clears the badge once the file reloads cleanly.
  SKILL_AUDIT_EVENTS_LOG: '.paqad/skills/events.jsonl',
  DOC_PROGRESS: '.paqad/doc-progress.json',
  DOC_RUN_SESSION: '.paqad/session/doc-run.json',
  PENTEST_ROOT_DIR: '.paqad/pentest',
  PENTEST_RUNS_DIR: '.paqad/pentest/runs',
  INDEXES_DIR: '.paqad/indexes',
  DOCS_DIR: 'docs',
  FRAMEWORK_DOCS_DIR: 'docs/framework',
  FRAMEWORK_STACK_DIR: 'docs/instructions/stack',
  RCA_DIR: 'docs/rca',
  PENTEST_DIR: 'docs/pentest',
  PENTEST_RETEST_DIR: 'docs/pentest/retests',
  RULES_DIR: 'docs/instructions/rules',
  MODULE_MAP: 'docs/instructions/rules/module-map.yml',
  TOOLS_DIR: 'docs/instructions/tools',
  INSTRUCTIONS_DIR: 'docs/instructions',
  ARCHITECTURE_DIR: 'docs/instructions/architecture',
  DESIGN_SYSTEM_DIR: 'docs/instructions/design-system',
  // Canonical, hand-edited source of truth for the design system. Co-located
  // with the Markdown it generates so source and outputs share one folder.
  DESIGN_TOKENS_FILE: 'docs/instructions/design-system/design-tokens.json',
  MODULES_DIR: 'docs/modules',
  REGISTRIES_DIR: 'docs/instructions/registries',
  BENCHMARKS_DIR: 'docs/instructions/benchmarks',
  TECH_DEBT_DIR: 'docs/instructions/tech-debt',
  MODULE_DB_DIR: 'database',
  MODULE_API_DIR: 'api',
  MODULE_INTEGRATION_DIR: 'integration',
  MODULE_UI_DIR: 'ui',
  MODULE_FEATURES_DIR: 'features',
  MODULE_USER_FLOWS_DIR: 'user-flows',
  MODULE_RESEARCH_DIR: 'research',
  MODULE_DECISIONS_DIR: 'decisions',
  MODULE_ERROR_CATALOG: 'error-catalog.md',
  CLAUDE_MD: 'CLAUDE.md',
  AGENTS_MD: 'AGENTS.md',
  ANTIGRAVITY_MD: 'ANTIGRAVITY.md',
  GEMINI_MD: 'GEMINI.md',
  SCRIPTS_DIR: 'scripts',
  HOOKS_DIR: '.paqad/hooks',
  LOGS_DIR: '.paqad/logs',
  LOCKS_DIR: '.paqad/locks',
  AUTO_UPDATE_LOG: '.paqad/logs/auto-update.log',
  // Issue #80 — living module lifecycle
  PROSPECTIVE_DECISIONS_DIR: '.paqad/decisions/module-decisions',
  MODULE_MAP_HISTORY_DIR: '.paqad/module-map/history',
  MODULE_MAP_EVENTS_LOG: '.paqad/module-map/events.jsonl',
  MODULE_MAP_DRIFT: '.paqad/module-map/drift.json',
  // PQD-95 — cross-artifact `.paqad/` schema versioning baseline.
  // SCHEMA_MARKER is the authoritative stamp readers check for layout
  // compatibility; SCHEMA_MIGRATION_LOG is an append-only JSONL record of every
  // forward migration; SCHEMA_MIGRATION_LOCK serialises concurrent migrators.
  SCHEMA_MARKER: '.paqad/schema-version.json',
  SCHEMA_MIGRATION_LOG: '.paqad/schema-migrations.jsonl',
  SCHEMA_MIGRATION_LOCK: '.paqad/locks/schema-migration.lock',
  // PQD-424 — resume checkpoint for onboarding. Records the project-relative
  // paths already written during a run so a re-run after an interrupt skips the
  // completed files and produces only the remainder. Written after the main
  // file batch and deleted once onboarding finishes cleanly, so it is normally
  // absent on disk and only lingers after an interrupted run.
  ONBOARDING_CHECKPOINT: '.paqad/onboarding-checkpoint.json',
  // Issue #89 — rules-as-scripts
  RULE_SCRIPT_MAP: 'docs/instructions/rules/rule-script-map.yml',
  RULE_SCRIPTS_DIR: '.paqad/scripts/rules',
  RULE_SCRIPTS_CACHE_DIR: '.paqad/scripts/rules/.cache',
  RULE_SCRIPTS_REPORT: '.paqad/scripts/rules/.cache/report.json',
  RULE_SCRIPTS_DRIFT: '.paqad/scripts/rules/.cache/drift.json',
  RULE_SCRIPT_MAP_HISTORY_DIR: '.paqad/scripts/rules/.history',
  RULE_SCRIPT_MAP_EVENTS_LOG: '.paqad/scripts/rules/.history/events.jsonl',
} as const;

export const REGISTRIES = [
  'module-registry.md',
  'feature-registry.md',
  'model-registry.md',
  'api-registry.md',
  'job-event-registry.md',
  'component-registry.md',
  'screen-registry.md',
  'table-registry.md',
  'query-registry.md',
  'test-registry.md',
  'error-code-registry.md',
  'integration-registry.md',
  'reuse-catalog.md',
] as const;
