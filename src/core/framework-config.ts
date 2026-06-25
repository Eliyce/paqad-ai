// Laravel-style framework configuration — the four-surface `.config` layer.
//
// Framework knobs (paqad on/off, enterprise, RAG, strictness, escalation,
// features, research depth, model routing, decision tuning, and version/update
// behaviour) are NOT project facts. They used to live in `project-profile.yaml`,
// which conflated "what this repo is" with "how the framework behaves". This
// module is the new home for the second category, modelled on Laravel:
//
//   - framework code defaults (this file) ............ Laravel `config/*.php`
//   - `.paqad/configs/.config.*` (tracked, merged) ... team-shared overrides
//   - `.paqad/.config` (git-ignored, flat KEY=VALUE)  dev-local overrides
//   - `PAQAD_*` env vars ............................. per-run escape hatch
//
// Onboarding writes one self-documenting `configs/.config.*` file per group, with
// every knob commented out at its default (the discoverability surface). Resolution
// precedence, lowest to highest (LOCAL WINS over team):
//   defaults → configs/.config.* (merged) → .config → PAQAD_* env → overrides
//
// HARD CUTOVER: framework knobs are sourced ONLY from the surfaces above. Any
// such keys still sitting in an existing `project-profile.yaml` are ignored on
// read and stripped on write.
//
// A single `FRAMEWORK_CONFIG_SPECS` table (the knob registry) is the one source
// of truth: it drives the defaults, the parser, the layered resolver, the
// generated group files, the env mapping, and the reconcile/prune pass, so they
// can never drift (tests assert the group files round-trip and the registry is
// internally consistent).

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from './constants/paths.js';
import { normalizeIntelligenceConfig } from './project-intelligence.js';
import type {
  DecisionProfileConfig,
  EfficiencyConfig,
  EnterpriseConfig,
  EscalationConfig,
  EscalationMode,
  IntelligenceConfig,
  ModelRoutingConfig,
  ProjectFeatureFlags,
  ProjectProfile,
  ResearchDepth,
  StrictnessConfig,
} from './types/project-profile.js';
import { ESCALATION_MODES, RESEARCH_DEPTHS } from './types/project-profile.js';

const EMBEDDING_PROVIDERS = ['local', 'openai', 'voyageai'] as const;
const ASK_THRESHOLDS = ['strict', 'balanced', 'permissive'] as const;

/** Tokens that mean boolean true / false in a config value (case-insensitive). */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

type ConfigValueType = 'boolean' | 'number' | 'string' | 'enum';

/** The coarse logical group a knob belongs to — the suggested `configs/.config.*`
 *  file it lives in. Purely organizational: every config file is globbed and
 *  merged, so a key works in any file. Drives the group-file layout and the README. */
export type ConfigGroup = 'app' | 'rag' | 'models' | 'policy';

/** The suggested `configs/` filename for each group (the resolver ignores the
 *  split and merges them all; this is documentation/convention only). */
export const CONFIG_GROUP_FILES: Record<ConfigGroup, string> = {
  app: '.config.app',
  rag: '.config.rag',
  models: '.config.models',
  policy: '.config.policy',
};

export interface FrameworkConfigSpec {
  /** Flat, bare, readable KEY as written in a `configs/.config.*` file. */
  key: string;
  /** The `PAQAD_*` environment-variable escape hatch for this knob. */
  env: string;
  type: ConfigValueType;
  /** The built-in default (the value when no override surface sets it). */
  default: boolean | number | string | undefined;
  /** Allowed values for `type: 'enum'`. */
  enumValues?: readonly string[];
  /** When true, an unset/empty value resolves to `undefined`, not the default. */
  optional?: boolean;
  /** The coarse `configs/` group this knob belongs to (its `configs/.config.*` file). */
  group: ConfigGroup;
  /** Section sub-header this key is grouped under in its group file. */
  section: string;
  /** One-line explanation rendered as a comment above the key in its group file. */
  comment: string;
}

// ── The one source of truth (the knob registry) ────────────────────────────
// Order here is the order rendered into each group file. Keys are bare and
// readable; each maps to a `PAQAD_*` env var for the per-run escape hatch.
export const FRAMEWORK_CONFIG_SPECS: readonly FrameworkConfigSpec[] = [
  // ── app group ──────────────────────────────────────────────────────────
  {
    key: 'paqad_enable',
    env: 'PAQAD_ENABLE',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Framework master switch',
    comment: 'Turn paqad off entirely (vanilla mode). Absent/true = on.',
  },
  {
    key: 'auto_update',
    env: 'PAQAD_AUTO_UPDATE',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Version & updates',
    comment: 'Pull newer framework versions in the background on session start.',
  },
  {
    key: 'minimum_version',
    env: 'PAQAD_MINIMUM_VERSION',
    type: 'string',
    default: 'latest',
    group: 'app',
    section: 'Version & updates',
    comment:
      'Refuse to run below this version. "latest" = no fixed floor, track newest. Or pin e.g. 1.28.1.',
  },
  {
    key: 'version_check_interval_hours',
    env: 'PAQAD_VERSION_CHECK_INTERVAL_HOURS',
    type: 'number',
    default: 12,
    group: 'app',
    section: 'Version & updates',
    comment: 'How often the background version check runs.',
  },
  {
    key: 'enterprise',
    env: 'PAQAD_ENTERPRISE',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Master switch for the enterprise/governance capabilities.',
  },
  {
    key: 'enterprise_evidence_ledger',
    env: 'PAQAD_ENTERPRISE_EVIDENCE_LEDGER',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Write the receipt + evidence ledger set under .paqad/ledger/.',
  },
  {
    key: 'enterprise_ai_bom',
    env: 'PAQAD_ENTERPRISE_AI_BOM',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Write the CycloneDX ai-bom.json view.',
  },
  {
    key: 'enterprise_compliance_citations',
    env: 'PAQAD_ENTERPRISE_COMPLIANCE_CITATIONS',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Resolve framework citations into the receipt (token-spending path).',
  },
  {
    key: 'spec_only_mode',
    env: 'PAQAD_SPEC_ONLY_MODE',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Stop after the spec phase; do not implement.',
  },
  {
    key: 'market_research',
    env: 'PAQAD_MARKET_RESEARCH',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Enable the market-research agent in planning.',
  },
  {
    key: 'design_research',
    env: 'PAQAD_DESIGN_RESEARCH',
    type: 'boolean',
    default: false,
    group: 'app',
    section: 'Feature flags',
    comment: 'Enable the design-research agent in planning.',
  },
  {
    key: 'team_agents',
    env: 'PAQAD_TEAM_AGENTS',
    type: 'boolean',
    default: true,
    group: 'app',
    section: 'Feature flags',
    comment: 'Use the multi-agent team for full-lane work.',
  },

  // ── rag group ──────────────────────────────────────────────────────────
  {
    key: 'rag_enabled',
    env: 'PAQAD_RAG_ENABLED',
    type: 'boolean',
    default: false,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Enable retrieval-augmented context loading.',
  },
  {
    key: 'rag_embedding_provider',
    env: 'PAQAD_RAG_EMBEDDING_PROVIDER',
    type: 'enum',
    enumValues: EMBEDDING_PROVIDERS,
    default: undefined,
    optional: true,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'local | openai | voyageai. Unset uses the local model.',
  },
  {
    key: 'rag_embedding_model',
    env: 'PAQAD_RAG_EMBEDDING_MODEL',
    type: 'string',
    default: undefined,
    optional: true,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Override the embedding model id. Unset = provider default.',
  },
  {
    key: 'rag_similarity_threshold',
    env: 'PAQAD_RAG_SIMILARITY_THRESHOLD',
    type: 'number',
    default: 0.75,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Minimum cosine similarity for a chunk to be retrieved.',
  },
  {
    key: 'rag_top_n',
    env: 'PAQAD_RAG_TOP_N',
    type: 'number',
    default: 20,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Max chunks retrieved per query.',
  },
  {
    key: 'rag_max_file_size',
    env: 'PAQAD_RAG_MAX_FILE_SIZE',
    type: 'number',
    default: 153600,
    group: 'rag',
    section: 'Intelligence / RAG',
    comment: 'Skip indexing files larger than this many bytes.',
  },

  // ── models group ───────────────────────────────────────────────────────
  {
    key: 'research_depth',
    env: 'PAQAD_RESEARCH_DEPTH',
    type: 'enum',
    enumValues: RESEARCH_DEPTHS,
    default: 'standard',
    group: 'models',
    section: 'Research & model routing',
    comment: 'cutting-edge | standard | conservative.',
  },
  {
    key: 'model_default',
    env: 'PAQAD_MODEL_DEFAULT',
    type: 'string',
    default: 'gpt-5',
    group: 'models',
    section: 'Research & model routing',
    comment: 'Default model for routine work.',
  },
  {
    key: 'model_reasoning',
    env: 'PAQAD_MODEL_REASONING',
    type: 'string',
    default: 'gpt-5',
    group: 'models',
    section: 'Research & model routing',
    comment: 'Model for heavy reasoning / planning.',
  },
  {
    key: 'model_fast',
    env: 'PAQAD_MODEL_FAST',
    type: 'string',
    default: 'gpt-5-mini',
    group: 'models',
    section: 'Research & model routing',
    comment: 'Cheap/fast model for lightweight steps.',
  },

  // ── policy group ───────────────────────────────────────────────────────
  {
    key: 'full_lane_default',
    env: 'PAQAD_FULL_LANE_DEFAULT',
    type: 'boolean',
    default: false,
    group: 'policy',
    section: 'Strictness / quality gates',
    comment: 'Route every task through the full (heaviest) lane by default.',
  },
  {
    key: 'require_adversarial_review',
    env: 'PAQAD_REQUIRE_ADVERSARIAL_REVIEW',
    type: 'boolean',
    default: true,
    group: 'policy',
    section: 'Strictness / quality gates',
    comment: 'Require an adversarial review pass before delivery.',
  },
  {
    key: 'block_on_stale_docs',
    env: 'PAQAD_BLOCK_ON_STALE_DOCS',
    type: 'boolean',
    default: true,
    group: 'policy',
    section: 'Strictness / quality gates',
    comment: 'Block delivery when canonical docs are out of date.',
  },
  {
    key: 'require_db_review_for_migrations',
    env: 'PAQAD_REQUIRE_DB_REVIEW_FOR_MIGRATIONS',
    type: 'boolean',
    default: true,
    group: 'policy',
    section: 'Strictness / quality gates',
    comment: 'Require a database review when a change includes migrations.',
  },
  {
    key: 'escalate_destructive_operations',
    env: 'PAQAD_ESCALATE_DESTRUCTIVE_OPERATIONS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'block',
    group: 'policy',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for destructive operations.',
  },
  {
    key: 'escalate_risky_migrations',
    env: 'PAQAD_ESCALATE_RISKY_MIGRATIONS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'warn',
    group: 'policy',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for risky migrations.',
  },
  {
    key: 'escalate_security_findings',
    env: 'PAQAD_ESCALATE_SECURITY_FINDINGS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'block',
    group: 'policy',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for security findings.',
  },
  {
    key: 'escalate_db_row_threshold',
    env: 'PAQAD_ESCALATE_DB_ROW_THRESHOLD',
    type: 'number',
    default: 10000,
    group: 'policy',
    section: 'Escalation policy',
    comment: 'Row count above which a data operation escalates.',
  },
  {
    key: 'decisions_ask_threshold',
    env: 'PAQAD_DECISIONS_ASK_THRESHOLD',
    type: 'enum',
    enumValues: ASK_THRESHOLDS,
    default: 'balanced',
    group: 'policy',
    section: 'Decisions (pause-contract tuning)',
    comment: 'strict | balanced | permissive — how eagerly to pause and ask.',
  },
  {
    key: 'decisions_max_screens_per_task',
    env: 'PAQAD_DECISIONS_MAX_SCREENS_PER_TASK',
    type: 'number',
    default: 3,
    group: 'policy',
    section: 'Decisions (pause-contract tuning)',
    comment: 'Max decision screens surfaced per task.',
  },
  {
    key: 'decisions_idle_timeout_minutes',
    env: 'PAQAD_DECISIONS_IDLE_TIMEOUT_MINUTES',
    type: 'number',
    default: 30,
    group: 'policy',
    section: 'Decisions (pause-contract tuning)',
    comment: 'Auto-resolve a pending decision after this idle window.',
  },
] as const;

const SPEC_BY_KEY = new Map<string, FrameworkConfigSpec>(
  FRAMEWORK_CONFIG_SPECS.map((spec) => [spec.key, spec]),
);

/** Every bare key the registry knows — the allow-list for the prune pass. */
export const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set(
  FRAMEWORK_CONFIG_SPECS.map((spec) => spec.key),
);

// Framework-internal efficiency tuning (Bucket C): never surfaced in a group
// file, never team-tuned. Lives here so the in-memory profile is complete for
// readers; overridable only via the escape hatch below.
const DEFAULT_EFFICIENCY_TUNING = {
  context_hit_rate_target: 0.7,
  skill_caching: true,
  differential_refresh: true,
  mcp_first: true,
} as const;

/** The resolved framework-config sections, shaped to overlay onto a profile. */
export interface ResolvedFrameworkConfig {
  paqad: { enabled: boolean };
  enterprise: EnterpriseConfig;
  intelligence: IntelligenceConfig;
  strictness: StrictnessConfig;
  escalation: EscalationConfig;
  features: ProjectFeatureFlags;
  research: { depth: ResearchDepth };
  model_routing: ModelRoutingConfig;
  decisions: DecisionProfileConfig;
  efficiency: EfficiencyConfig;
}

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse flat `KEY=VALUE` config text into a map. Rules (Laravel `.env`-ish):
 * - Blank lines and full-line `#` comments are ignored.
 * - A line without `=` is ignored (not an assignment).
 * - `export KEY=...` is tolerated (the `export ` prefix is dropped).
 * - Quoted values (`"..."` / `'...'`) are taken verbatim, inner content only.
 * - Unquoted values are trimmed and an inline ` # comment` is stripped.
 * - A trailing `\r` (CRLF / Windows-authored file) is stripped by the split.
 * - Duplicate keys within one file: last assignment wins.
 */
export function parseDotConfig(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) {
      key = key.slice('export '.length).trim();
    }
    if (key === '') {
      continue;
    }
    out.set(key, stripValue(line.slice(eq + 1)));
  }
  return out;
}

function stripValue(raw: string): string {
  const v = raw.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  const inlineComment = v.search(/\s#/u);
  return inlineComment === -1 ? v : v.slice(0, inlineComment).trim();
}

/** Read and parse `.paqad/.config` (the local layer); absent/unreadable ⇒ empty. */
export function readDotConfig(projectRoot: string): Map<string, string> {
  try {
    return parseDotConfig(readFileSync(join(projectRoot, PATHS.PROJECT_CONFIG), 'utf8'));
  } catch {
    return new Map();
  }
}

/** The absolute paths of the team `configs/.config.*` files, sorted by filename
 *  for deterministic last-wins merge. A legacy `.paqad/.config.example` (from an
 *  older version) lives in the parent dir and is excluded defensively. */
export function listConfigsFiles(projectRoot: string): string[] {
  const dir = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => /^\.config\..+/u.test(name) && name !== '.config.example')
    .sort()
    .map((name) => join(dir, name));
}

/** A collision: the same key set by more than one `configs/.config.*` file. */
export interface ConfigsCollision {
  key: string;
  files: string[];
}

/**
 * Merge every `configs/.config.*` file (the tracked team layer) into one map,
 * filenames in sorted order so a later file wins deterministically. Keys are
 * meant to be globally unique across the files (the split is organizational), so
 * any key set by two files is reported as a collision for the caller to surface.
 */
export function readConfigsDir(projectRoot: string): {
  merged: Map<string, string>;
  collisions: ConfigsCollision[];
} {
  const merged = new Map<string, string>();
  const seenIn = new Map<string, string[]>();
  for (const file of listConfigsFiles(projectRoot)) {
    let parsed: Map<string, string>;
    try {
      parsed = parseDotConfig(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    for (const [key, value] of parsed) {
      merged.set(key, value); // last file (sorted) wins
      seenIn.set(key, [...(seenIn.get(key) ?? []), file]);
    }
  }
  const collisions: ConfigsCollision[] = [];
  for (const [key, files] of seenIn) {
    if (files.length > 1) {
      collisions.push({ key, files });
    }
  }
  return { merged, collisions };
}

/**
 * The fully-layered override map for a project root, lowest precedence applied
 * first so the highest wins (LOCAL WINS over team):
 *   configs/.config.* (team)  →  .config (local)  →  PAQAD_* env (escape hatch)
 *
 * The framework code defaults sit below all of these and are applied during
 * coercion (an absent key ⇒ its registry default). Env values are keyed back to
 * the bare key via the registry's `env` mapping; an empty env var is ignored so
 * it never shadows a real lower-layer value.
 */
export function layeredConfigMap(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, string> {
  const merged = new Map<string, string>();
  // 1. team layer (configs/.config.*), lowest override
  for (const [key, value] of readConfigsDir(projectRoot).merged) {
    merged.set(key, value);
  }
  // 2. local layer (.config) — LOCAL WINS over team
  for (const [key, value] of readDotConfig(projectRoot)) {
    merged.set(key, value);
  }
  // 3. env escape hatch (PAQAD_*) — wins over both files
  for (const spec of FRAMEWORK_CONFIG_SPECS) {
    const raw = env[spec.env];
    if (typeof raw === 'string' && raw.trim() !== '') {
      merged.set(spec.key, raw);
    }
  }
  return merged;
}

/**
 * Raw, side-effect-free read of the off-signal across the layered surfaces. True
 * iff the resolved `paqad_enable` (env `PAQAD_ENABLE` > `.config` > `configs/`)
 * is present and resolves to a falsy token (`false`/`0`/`no`/`off`). Absent,
 * truthy, or unrecognised ⇒ false (not disabled). Mirrors the dist-less
 * `paqad-disabled.{sh,mjs}` primitives so all three agree on "off". The dedicated
 * `PAQAD_DISABLED` hard switch is layered on top by `framework-enabled.ts`.
 */
export function configSaysPaqadDisabled(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = layeredConfigMap(projectRoot, env).get('paqad_enable');
  return raw !== undefined && FALSY.has(raw.trim().toLowerCase());
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Upsert a single `KEY=value` assignment in `.paqad/.config` (the local layer),
 * preserving every other line, comment, and the ordering. Replaces the first
 * uncommented assignment of `key` if present; otherwise appends. Creates the file
 * (and `.paqad/`) when absent. This is the write behind `paqad-ai enable/disable`
 * and the dashboard — LOCAL WINS, so a local write always takes effect over team
 * files without dirtying a tracked file.
 */
export function setConfigValue(projectRoot: string, key: string, value: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIG);
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    // keep the empty default — file will be created below
  }
  const lines = existing.replace(/\n+$/u, '').split(/\r?\n/);
  const assignRe = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`, 'u');
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && !line.trimStart().startsWith('#') && assignRe.test(line)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) {
    if (next.length === 1 && next[0] === '') {
      next[0] = `${key}=${value}`;
    } else {
      next.push(`${key}=${value}`);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${next.join('\n')}\n`, 'utf8');
  return path;
}

// ── Coercion ─────────────────────────────────────────────────────────────

function asBool(raw: string | undefined, def: boolean): boolean {
  if (raw === undefined) {
    return def;
  }
  const t = raw.trim().toLowerCase();
  if (TRUTHY.has(t)) {
    return true;
  }
  if (FALSY.has(t)) {
    return false;
  }
  return def;
}

function asNum(raw: string | undefined, def: number): number {
  if (raw === undefined || raw.trim() === '') {
    return def;
  }
  const n = Number(raw.trim());
  return Number.isFinite(n) ? n : def;
}

function asStr(raw: string | undefined, def: string): string {
  if (raw === undefined || raw.trim() === '') {
    return def;
  }
  return raw.trim();
}

function asEnum<T extends string>(raw: string | undefined, allowed: readonly T[], def: T): T {
  if (raw === undefined) {
    return def;
  }
  const t = raw.trim();
  return (allowed as readonly string[]).includes(t) ? (t as T) : def;
}

function asOptEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const t = raw.trim();
  return (allowed as readonly string[]).includes(t) ? (t as T) : undefined;
}

function defOf(key: string): boolean | number | string | undefined {
  return SPEC_BY_KEY.get(key)?.default;
}

// ── Resolution ───────────────────────────────────────────────────────────

/** Resolve framework config from an already-layered override map. */
export function resolveFrameworkConfigFromMap(raw: Map<string, string>): ResolvedFrameworkConfig {
  const rb = (key: string): boolean => asBool(raw.get(key), defOf(key) as boolean);
  const rn = (key: string): number => asNum(raw.get(key), defOf(key) as number);
  const rs = (key: string): string => asStr(raw.get(key), defOf(key) as string);

  const provider = asOptEnum(raw.get('rag_embedding_provider'), EMBEDDING_PROVIDERS);
  const embeddingModel = raw.get('rag_embedding_model')?.trim() || undefined;

  const intelligence = normalizeIntelligenceConfig({
    rag_enabled: rb('rag_enabled'),
    embedding_provider: provider,
    embedding_model: embeddingModel,
    rag_similarity_threshold: rn('rag_similarity_threshold'),
    rag_top_n: rn('rag_top_n'),
    rag_max_file_size: rn('rag_max_file_size'),
  });

  return {
    paqad: { enabled: rb('paqad_enable') },
    enterprise: {
      enabled: rb('enterprise'),
      evidence_ledger: rb('enterprise_evidence_ledger'),
      ai_bom: rb('enterprise_ai_bom'),
      compliance_citations: rb('enterprise_compliance_citations'),
    },
    intelligence,
    strictness: {
      full_lane_default: rb('full_lane_default'),
      require_adversarial_review: rb('require_adversarial_review'),
      block_on_stale_docs: rb('block_on_stale_docs'),
      require_db_review_for_migrations: rb('require_db_review_for_migrations'),
    },
    escalation: {
      destructive_operations: asEnum(
        raw.get('escalate_destructive_operations'),
        ESCALATION_MODES,
        defOf('escalate_destructive_operations') as EscalationMode,
      ),
      risky_migrations: asEnum(
        raw.get('escalate_risky_migrations'),
        ESCALATION_MODES,
        defOf('escalate_risky_migrations') as EscalationMode,
      ),
      security_findings: asEnum(
        raw.get('escalate_security_findings'),
        ESCALATION_MODES,
        defOf('escalate_security_findings') as EscalationMode,
      ),
      db_row_threshold: rn('escalate_db_row_threshold'),
    },
    features: {
      spec_only_mode: rb('spec_only_mode'),
      market_research: rb('market_research'),
      design_research: rb('design_research'),
      team_agents: rb('team_agents'),
    },
    research: {
      depth: asEnum(
        raw.get('research_depth'),
        RESEARCH_DEPTHS,
        defOf('research_depth') as ResearchDepth,
      ),
    },
    model_routing: {
      default_model: rs('model_default'),
      reasoning_model: rs('model_reasoning'),
      fast_model: rs('model_fast'),
    },
    decisions: {
      ask_threshold: asEnum(
        raw.get('decisions_ask_threshold'),
        ASK_THRESHOLDS,
        defOf('decisions_ask_threshold') as DecisionProfileConfig['ask_threshold'] & string,
      ),
      max_screens_per_task: rn('decisions_max_screens_per_task'),
      idle_timeout_minutes: rn('decisions_idle_timeout_minutes'),
    },
    efficiency: {
      ...DEFAULT_EFFICIENCY_TUNING,
      auto_update: rb('auto_update'),
      minimum_version: rs('minimum_version'),
      version_check_interval_hours: rn('version_check_interval_hours'),
    },
  };
}

/** Resolve framework config for a project root across all four surfaces. */
export function resolveFrameworkConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedFrameworkConfig {
  return resolveFrameworkConfigFromMap(layeredConfigMap(projectRoot, env));
}

/** The all-defaults resolution (no override surface present). */
export const DEFAULT_FRAMEWORK_CONFIG: ResolvedFrameworkConfig = resolveFrameworkConfigFromMap(
  new Map(),
);

// ── Overlay / strip (the storage seam) ─────────────────────────────────────

// The `custom.decisions` sub-keys owned by the config layer (the simple,
// commonly-tuned knobs). The remaining sub-keys (`preferred_option_keys`,
// `ttl_overrides_days`, `max_pending`) are project-specific values, not framework
// tuning, so they STAY in `project-profile.yaml` and are preserved across the
// overlay/strip seam.
const DECISION_CONFIG_KEYS = [
  'ask_threshold',
  'max_screens_per_task',
  'idle_timeout_minutes',
] as const;

/** The top-level profile keys owned by the framework-config layer. */
export const FRAMEWORK_CONFIG_SECTIONS = [
  'paqad',
  'enterprise',
  'intelligence',
  'strictness',
  'escalation',
  'features',
  'research',
  'model_routing',
  'efficiency',
] as const;

/**
 * Overlay resolved framework config onto a (lean) profile, producing the full
 * in-memory `ProjectProfile` the rest of the engine reads. Any framework keys
 * present on `base` are replaced (hard cutover): the profile is never the source
 * of truth for these. `custom.decisions` is overlaid while the project-owned
 * `custom` arrays are preserved.
 */
export function applyFrameworkConfigToProfile(
  base: ProjectProfile,
  resolved: ResolvedFrameworkConfig = DEFAULT_FRAMEWORK_CONFIG,
): ProjectProfile {
  return {
    ...base,
    paqad: resolved.paqad,
    enterprise: resolved.enterprise,
    intelligence: resolved.intelligence,
    strictness: resolved.strictness,
    escalation: resolved.escalation,
    features: resolved.features,
    research: resolved.research,
    model_routing: resolved.model_routing,
    efficiency: resolved.efficiency,
    custom: {
      classification_dimensions: base.custom?.classification_dimensions ?? [],
      verification_plugins: base.custom?.verification_plugins ?? [],
      escalation_rules: base.custom?.escalation_rules ?? [],
      // Merge the config-owned simple knobs OVER the project-specific advanced
      // sub-keys preserved on the base profile (preferred_option_keys, etc.).
      decisions: { ...base.custom?.decisions, ...resolved.decisions },
      ...(base.custom?.flaky ? { flaky: base.custom.flaky } : {}),
    },
  };
}

/**
 * Strip framework-config sections from a profile so only project facts persist
 * to `project-profile.yaml`. The inverse of {@link applyFrameworkConfigToProfile}
 * for the write path. `custom.decisions` is dropped; the project-owned `custom`
 * arrays are kept.
 */
export function stripFrameworkConfigFromProfile<T extends Partial<ProjectProfile>>(
  profile: T,
): Partial<ProjectProfile> {
  const clone: Record<string, unknown> = { ...profile };
  for (const section of FRAMEWORK_CONFIG_SECTIONS) {
    delete clone[section];
  }
  const custom = (profile as ProjectProfile).custom;
  if (custom) {
    const { decisions, ...customRest } = custom;
    // Drop only the config-owned simple knobs from `decisions`; keep any
    // project-specific advanced sub-keys (and the block itself) in the YAML.
    if (decisions) {
      const kept: Record<string, unknown> = { ...decisions };
      for (const key of DECISION_CONFIG_KEYS) {
        delete kept[key];
      }
      if (Object.keys(kept).length > 0) {
        (customRest as Record<string, unknown>).decisions = kept;
      }
    }
    clone.custom = customRest;
  }
  return clone as Partial<ProjectProfile>;
}

// ── `configs/.config.*` group-file + `configs/README` generation ───────────

/** One-line title for each group's file header. */
const CONFIG_GROUP_TITLES: Record<ConfigGroup, string> = {
  app: 'Application, version, enterprise, and feature flags',
  rag: 'Intelligence / RAG',
  models: 'Research depth and model routing',
  policy: 'Quality, escalation, and decision policy',
};

/** Intro prose for each group's file header (what this file controls). */
const CONFIG_GROUP_INTROS: Record<ConfigGroup, string[]> = {
  app: [
    'The framework master switch, the background version/update policy, the licensed',
    'enterprise/governance switches, and the planning feature flags.',
  ],
  rag: [
    'Retrieval-augmented context loading: whether it is on, the embedding provider and',
    'model, and the retrieval tuning (similarity threshold, top-N, file-size limit).',
  ],
  models: [
    'How deep research goes, and which models handle routine, heavy-reasoning, and',
    'fast/cheap work.',
  ],
  policy: [
    'Strictness gates (adversarial review, stale-doc blocking, DB-migration review),',
    'escalation modes for risky operations, and decision-pause tuning.',
  ],
};

function renderDefault(spec: FrameworkConfigSpec): string {
  return spec.default === undefined ? '' : String(spec.default);
}

/** True when `text` already contains `key` in any form (active or commented). */
function fileHasKey(text: string, key: string): boolean {
  return new RegExp(`^\\s*#?\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`, 'mu').test(text);
}

/**
 * Render one tracked `configs/.config.<group>` file: an intro header explaining
 * what the group controls, then every knob in that group as a COMMENTED-OUT
 * assignment at its default, preceded by a one-line explanation and its `PAQAD_*`
 * env equivalent. Because every line is commented, the file is inert until a line
 * is uncommented, so a freshly-onboarded project runs entirely on code defaults.
 * `overrides` re-emits the team's already-active (uncommented) values when the
 * file is refreshed.
 */
export function generateGroupConfig(
  group: ConfigGroup,
  overrides: Map<string, string> = new Map(),
): string {
  const lines: string[] = [
    `# .paqad/configs/${CONFIG_GROUP_FILES[group]} — ${CONFIG_GROUP_TITLES[group]}`,
    '#',
    ...CONFIG_GROUP_INTROS[group].map((l) => `# ${l}`),
    '#',
    '# Every key below is COMMENTED OUT, so paqad uses its built-in default until you',
    '# uncomment a line to override it. Precedence, highest first: PAQAD_* env var >',
    '# your local ../.config > these tracked team files > code default. This file is',
    '# tracked; `paqad-ai update` refreshes it and keeps every value you uncommented.',
    '',
  ];

  let currentSection = '';
  for (const spec of FRAMEWORK_CONFIG_SPECS.filter((s) => s.group === group)) {
    if (spec.section !== currentSection) {
      if (currentSection !== '') {
        lines.push('');
      }
      lines.push(`# ── ${spec.section} ${'─'.repeat(Math.max(0, 56 - spec.section.length))}`);
      currentSection = spec.section;
    }
    lines.push(`# ${spec.comment} (env: ${spec.env})`);
    const override = overrides.get(spec.key);
    lines.push(
      override !== undefined ? `${spec.key}=${override}` : `# ${spec.key}=${renderDefault(spec)}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Write/refresh the tracked `configs/.config.*` group files. Absent files (a
 * fresh onboard, or a project upgrading from before this feature) are generated
 * fully, with every key commented out. Existing files are left in place and only
 * GAIN newly-introduced keys (appended, commented) — every line the team has,
 * including the values they uncommented, is preserved verbatim. Removal of
 * obsolete keys is handled by {@link reconcileConfigOverrides}. Returns the file
 * paths that were created or appended to.
 */
export function syncGroupConfigs(projectRoot: string): string[] {
  const written: string[] = [];
  for (const group of Object.keys(CONFIG_GROUP_FILES) as ConfigGroup[]) {
    const file = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR, CONFIG_GROUP_FILES[group]);
    let existing: string | null;
    try {
      existing = readFileSync(file, 'utf8');
    } catch {
      existing = null;
    }
    mkdirSync(dirname(file), { recursive: true });

    if (existing === null) {
      writeFileSync(file, generateGroupConfig(group), 'utf8');
      written.push(file);
      continue;
    }

    const missing = FRAMEWORK_CONFIG_SPECS.filter(
      (s) => s.group === group && !fileHasKey(existing as string, s.key),
    );
    if (missing.length === 0) {
      continue; // byte-identical: never rewrite a file we did not change
    }
    const additions = ['', `# ── Added in a newer paqad version ${'─'.repeat(28)}`];
    for (const spec of missing) {
      additions.push(`# ${spec.comment} (env: ${spec.env})`);
      additions.push(`# ${spec.key}=${renderDefault(spec)}`);
    }
    writeFileSync(file, `${existing.replace(/\n+$/u, '')}\n${additions.join('\n')}\n`, 'utf8');
    written.push(file);
  }
  return written;
}

/** Render the tracked `configs/README` explaining the team-override convention. */
export function generateConfigsReadme(): string {
  const groupLines = (Object.keys(CONFIG_GROUP_FILES) as ConfigGroup[]).map(
    (group) => `- \`${CONFIG_GROUP_FILES[group]}\` — ${CONFIG_GROUP_TITLES[group]}`,
  );
  return [
    '# paqad team configuration (`.paqad/configs/`)',
    '',
    'Tracked, team-shared framework overrides. Onboarding writes one file per group,',
    'each pre-filled with every knob in that group, commented out and documented:',
    '',
    ...groupLines,
    '',
    'Every file in this directory is merged into one map and read at runtime, so the',
    'split is purely organizational — a key works in any file.',
    '',
    'For a single copy-paste reference listing every knob in one place, see',
    '`../.config.example` (tracked, never read at runtime).',
    '',
    '## How to use',
    '',
    '- Uncomment a line to override that knob. While a key stays commented (or absent),',
    '  paqad uses its built-in code default, so an untouched project runs entirely on',
    '  defaults.',
    '- Keys must be globally unique across these files. The same key uncommented in two',
    '  files is a collision: the alphabetically-last filename wins, and `paqad-ai',
    '  onboard`/`update` reports it.',
    '- A teammate’s local `../.config` (git-ignored) overrides anything here, and a',
    '  `PAQAD_*` env var overrides everything.',
    '- `paqad-ai update` refreshes these files: it appends knobs added in a new version',
    '  (commented) and prunes knobs a new version removed, but never changes a value you',
    '  uncommented. It never resets your settings to defaults.',
    '',
  ].join('\n');
}

/** Write the tracked `.paqad/configs/README` (framework-owned; refreshed on update). */
export function writeConfigsReadme(projectRoot: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIGS_README);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateConfigsReadme(), 'utf8');
  return path;
}

/**
 * Render the single `.config.example` catalog: every framework knob (across all
 * groups), commented out at its default, with its one-line explanation and its
 * `PAQAD_*` env equivalent. A copy-paste reference so a team never has to guess a
 * variable name. Like Laravel's `.env.example`, it is tracked but **never read at
 * runtime** — copy a line into a `configs/.config.*` (team) or `.config` (local)
 * file, uncomment it, and set the value.
 */
export function generateConfigExample(): string {
  const lines: string[] = [
    '# paqad framework configuration — catalog of every knob (.paqad/.config.example)',
    '#',
    '# A copy-paste reference: every framework knob, with its default, a one-line',
    '# explanation, and its PAQAD_* env equivalent. This file is NEVER read at',
    '# runtime. To override a knob, copy its line into a tracked configs/.config.*',
    '# file (team) or your git-ignored .config (local), uncomment it, and set a value.',
    '#',
    '# Precedence, highest first: PAQAD_* env var > .config (local) > configs/.config.*',
    '# (team) > code default. With nothing uncommented anywhere, every knob is at the',
    '# default shown below — identical to a fresh install.',
    '',
  ];

  let currentSection = '';
  for (const spec of FRAMEWORK_CONFIG_SPECS) {
    if (spec.section !== currentSection) {
      if (currentSection !== '') {
        lines.push('');
      }
      lines.push(`# ── ${spec.section} ${'─'.repeat(Math.max(0, 56 - spec.section.length))}`);
      currentSection = spec.section;
    }
    lines.push(`# ${spec.comment} (env: ${spec.env})`);
    lines.push(`# ${spec.key}=${renderDefault(spec)}`);
  }

  lines.push('');
  return lines.join('\n');
}

/** Write the tracked `.paqad/.config.example` catalog. Always refreshed (like
 *  Laravel's `.env.example`) so newly-shipped keys appear after an update. */
export function writeConfigExample(projectRoot: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIG_EXAMPLE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateConfigExample(), 'utf8');
  return path;
}

// ── Reconcile (the knob add/remove evolution path) ─────────────────────────

/** One override file that the reconcile pass pruned obsolete keys from. */
export interface ReconciledConfigFile {
  /** Project-relative path of the file. */
  path: string;
  /** Keys removed because this version of the registry no longer knows them. */
  removed: string[];
}

/**
 * Surgically remove obsolete keys (keys the current registry no longer knows)
 * from one config file's text, preserving EVERY other line — comments, blank
 * lines, ordering, and every still-valid key's exact value. Returns the new text
 * and the list of removed keys. Never rewrites values or adds keys; a file with
 * only known keys is returned byte-identical.
 */
export function pruneUnknownKeysFromText(
  text: string,
  known: ReadonlySet<string> = KNOWN_CONFIG_KEYS,
): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = text.split('\n').filter((line) => {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) {
      return true; // preserve blanks and comments verbatim
    }
    const m = trimmed.match(/^(?:export\s+)?([^=\s]+)\s*=/u);
    if (!m) {
      return true; // not an assignment — leave it alone
    }
    if (known.has(m[1])) {
      return true;
    }
    removed.push(m[1]);
    return false;
  });
  return { text: kept.join('\n'), removed };
}

/**
 * Reconcile the team/local override files against the current knob registry.
 * Runs during `onboard`/`update` only. For `.config` and every `configs/.config.*`
 * file, it PRUNES uncommented keys this version no longer knows and leaves
 * everything else untouched — it never resets a value, never converts a file to
 * defaults, and never injects new keys here (newly-added keys are appended to
 * their group file, commented, by {@link syncGroupConfigs}). Returns the per-file
 * report of what was pruned (empty when nothing changed).
 */
export function reconcileConfigOverrides(projectRoot: string): ReconciledConfigFile[] {
  const report: ReconciledConfigFile[] = [];
  const localConfig = join(projectRoot, PATHS.PROJECT_CONFIG);
  const targets = [localConfig, ...listConfigsFiles(projectRoot)];
  for (const file of targets) {
    let original: string;
    try {
      original = readFileSync(file, 'utf8');
    } catch {
      continue; // absent ⇒ nothing to reconcile
    }
    const { text, removed } = pruneUnknownKeysFromText(original);
    if (removed.length === 0) {
      continue; // byte-identical: never rewrite a file we did not change
    }
    writeFileSync(file, text, 'utf8');
    report.push({ path: file.slice(projectRoot.length + 1), removed });
  }
  return report;
}

/**
 * The no-migration safety net. Read the RAW on-disk `project-profile.yaml` and
 * report the framework knobs it carries whose value differs from the code
 * default — i.e. exactly what a hard-cutover strip is about to revert. Returns
 * `key=value` strings (empty when the profile is absent, lean, or already at
 * defaults). The caller turns a silent revert into a one-time visible notice;
 * nothing is rewritten or preserved.
 */
export function detectFlippedFrameworkValues(projectRoot: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(join(projectRoot, PATHS.PROJECT_PROFILE), 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  return [...frameworkOverridesToFlat(parsed as Partial<ProjectProfile>)].map(
    ([key, value]) => `${key}=${value}`,
  );
}

/**
 * Map the framework sections of a (partial) profile to the flat config keys whose
 * value DIFFERS from the built-in default. Used to persist explicit overrides
 * (desktop onboarding, the dashboard) into `.config` without materializing the
 * full default set.
 */
export function frameworkOverridesToFlat(overrides: Partial<ProjectProfile>): Map<string, string> {
  const out = new Map<string, string>();
  const d = DEFAULT_FRAMEWORK_CONFIG;
  const put = (key: string, value: unknown, def: unknown): void => {
    if (value !== undefined && String(value) !== String(def)) {
      out.set(key, String(value));
    }
  };

  if (overrides.paqad) {
    put('paqad_enable', overrides.paqad.enabled, d.paqad.enabled);
  }
  if (overrides.enterprise) {
    put('enterprise', overrides.enterprise.enabled, d.enterprise.enabled);
    put(
      'enterprise_evidence_ledger',
      overrides.enterprise.evidence_ledger,
      d.enterprise.evidence_ledger,
    );
    put('enterprise_ai_bom', overrides.enterprise.ai_bom, d.enterprise.ai_bom);
    put(
      'enterprise_compliance_citations',
      overrides.enterprise.compliance_citations,
      d.enterprise.compliance_citations,
    );
  }
  if (overrides.intelligence) {
    const i = overrides.intelligence;
    put('rag_enabled', i.rag_enabled, d.intelligence.rag_enabled);
    put('rag_embedding_provider', i.embedding_provider, d.intelligence.embedding_provider);
    put('rag_embedding_model', i.embedding_model, d.intelligence.embedding_model);
    put(
      'rag_similarity_threshold',
      i.rag_similarity_threshold,
      d.intelligence.rag_similarity_threshold,
    );
    put('rag_top_n', i.rag_top_n, d.intelligence.rag_top_n);
    put('rag_max_file_size', i.rag_max_file_size, d.intelligence.rag_max_file_size);
  }
  if (overrides.strictness) {
    const s = overrides.strictness;
    put('full_lane_default', s.full_lane_default, d.strictness.full_lane_default);
    put(
      'require_adversarial_review',
      s.require_adversarial_review,
      d.strictness.require_adversarial_review,
    );
    put('block_on_stale_docs', s.block_on_stale_docs, d.strictness.block_on_stale_docs);
    put(
      'require_db_review_for_migrations',
      s.require_db_review_for_migrations,
      d.strictness.require_db_review_for_migrations,
    );
  }
  if (overrides.escalation) {
    const e = overrides.escalation;
    put(
      'escalate_destructive_operations',
      e.destructive_operations,
      d.escalation.destructive_operations,
    );
    put('escalate_risky_migrations', e.risky_migrations, d.escalation.risky_migrations);
    put('escalate_security_findings', e.security_findings, d.escalation.security_findings);
    put('escalate_db_row_threshold', e.db_row_threshold, d.escalation.db_row_threshold);
  }
  if (overrides.features) {
    const f = overrides.features;
    put('spec_only_mode', f.spec_only_mode, d.features.spec_only_mode);
    put('market_research', f.market_research, d.features.market_research);
    put('design_research', f.design_research, d.features.design_research);
    put('team_agents', f.team_agents, d.features.team_agents);
  }
  if (overrides.research) {
    put('research_depth', overrides.research.depth, d.research.depth);
  }
  if (overrides.model_routing) {
    const m = overrides.model_routing;
    put('model_default', m.default_model, d.model_routing.default_model);
    put('model_reasoning', m.reasoning_model, d.model_routing.reasoning_model);
    put('model_fast', m.fast_model, d.model_routing.fast_model);
  }
  if (overrides.custom?.decisions) {
    const dec = overrides.custom.decisions;
    put('decisions_ask_threshold', dec.ask_threshold, d.decisions.ask_threshold);
    put(
      'decisions_max_screens_per_task',
      dec.max_screens_per_task,
      d.decisions.max_screens_per_task,
    );
    put(
      'decisions_idle_timeout_minutes',
      dec.idle_timeout_minutes,
      d.decisions.idle_timeout_minutes,
    );
  }
  if (overrides.efficiency) {
    const ef = overrides.efficiency;
    put('auto_update', ef.auto_update, d.efficiency.auto_update);
    put('minimum_version', ef.minimum_version, d.efficiency.minimum_version);
    put(
      'version_check_interval_hours',
      ef.version_check_interval_hours,
      d.efficiency.version_check_interval_hours,
    );
  }
  return out;
}

/**
 * Persist explicit framework overrides into `.paqad/.config`. Only values that
 * differ from the default are written (the file stays minimal and meaningful).
 * Returns the keys written. The complementary "reset a key to default" path is a
 * direct {@link setConfigValue} call by the caller.
 */
export function writeFrameworkOverridesToConfig(
  projectRoot: string,
  overrides: Partial<ProjectProfile>,
): string[] {
  const written: string[] = [];
  for (const [key, value] of frameworkOverridesToFlat(overrides)) {
    setConfigValue(projectRoot, key, value);
    written.push(key);
  }
  return written;
}

/** Remove every uncommented assignment of `key` from `.paqad/.config`, leaving
 *  comments and other keys untouched. No-op when the file is absent. */
export function removeConfigValue(projectRoot: string, key: string): void {
  const path = join(projectRoot, PATHS.PROJECT_CONFIG);
  let existing: string;
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  const assignRe = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(key)}\\s*=`, 'u');
  const kept = existing
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('#') || !assignRe.test(line));
  writeFileSync(path, kept.join('\n'), 'utf8');
}

/**
 * Which config keys belong to which profile section, and how to tell that section
 * is present on a (partial) profile. Drives the authoritative sync below so a
 * partial profile only touches its own sections. A test asserts this covers every
 * spec key exactly once, so it cannot drift from FRAMEWORK_CONFIG_SPECS.
 */
export const CONFIG_KEY_SECTIONS: ReadonlyArray<{
  present: (p: Partial<ProjectProfile>) => boolean;
  keys: readonly string[];
}> = [
  { present: (p) => p.paqad !== undefined, keys: ['paqad_enable'] },
  {
    present: (p) => p.enterprise !== undefined,
    keys: [
      'enterprise',
      'enterprise_evidence_ledger',
      'enterprise_ai_bom',
      'enterprise_compliance_citations',
    ],
  },
  {
    present: (p) => p.intelligence !== undefined,
    keys: [
      'rag_enabled',
      'rag_embedding_provider',
      'rag_embedding_model',
      'rag_similarity_threshold',
      'rag_top_n',
      'rag_max_file_size',
    ],
  },
  {
    present: (p) => p.strictness !== undefined,
    keys: [
      'full_lane_default',
      'require_adversarial_review',
      'block_on_stale_docs',
      'require_db_review_for_migrations',
    ],
  },
  {
    present: (p) => p.escalation !== undefined,
    keys: [
      'escalate_destructive_operations',
      'escalate_risky_migrations',
      'escalate_security_findings',
      'escalate_db_row_threshold',
    ],
  },
  {
    present: (p) => p.features !== undefined,
    keys: ['spec_only_mode', 'market_research', 'design_research', 'team_agents'],
  },
  { present: (p) => p.research !== undefined, keys: ['research_depth'] },
  {
    present: (p) => p.model_routing !== undefined,
    keys: ['model_default', 'model_reasoning', 'model_fast'],
  },
  {
    present: (p) => p.custom?.decisions !== undefined,
    keys: [
      'decisions_ask_threshold',
      'decisions_max_screens_per_task',
      'decisions_idle_timeout_minutes',
    ],
  },
  {
    present: (p) => p.efficiency !== undefined,
    keys: ['auto_update', 'minimum_version', 'version_check_interval_hours'],
  },
];

/**
 * Make `.paqad/.config` authoritatively reflect the framework state of a profile,
 * SECTION BY SECTION: for each section present on `profile`, every knob that
 * differs from its default is written and every knob that equals its default is
 * removed. Sections absent from `profile` are left untouched (so a partial PUT —
 * e.g. RAG-only — never wipes unrelated keys). This is the write behind the
 * dashboard's management surface, where the submitted form is the COMPLETE
 * desired state for the sections it carries (a toggle back to default must clear
 * the key, not leave it stale). Comments and non-framework lines are preserved.
 */
export function syncFrameworkConfig(projectRoot: string, profile: Partial<ProjectProfile>): void {
  const nonDefault = frameworkOverridesToFlat(profile);
  for (const section of CONFIG_KEY_SECTIONS) {
    if (!section.present(profile)) {
      continue;
    }
    for (const key of section.keys) {
      const value = nonDefault.get(key);
      if (value !== undefined) {
        setConfigValue(projectRoot, key, value);
      } else {
        removeConfigValue(projectRoot, key);
      }
    }
  }
}
