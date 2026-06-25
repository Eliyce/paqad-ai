// Laravel-style framework configuration (the `.paqad/.config` layer).
//
// Framework knobs (paqad on/off, enterprise, RAG, strictness, escalation,
// features, research depth, model routing, decision tuning, and version/update
// behaviour) are NOT project facts. They used to live in `project-profile.yaml`,
// which conflated "what this repo is" with "how the framework behaves". This
// module is the new home for the second category, modelled on Laravel:
//
//   - DEFAULT_FRAMEWORK_CONFIG (in code) ............ Laravel `config/*.php`
//   - `.paqad/.config` (git-ignored, flat KEY=VALUE)  Laravel `.env`
//   - `.paqad/.config.example` (tracked, commented) . Laravel `.env.example`
//
// Resolution precedence, lowest to highest:
//   framework defaults  →  `.paqad/.config`  →  programmatic `profileOverrides`
//
// HARD CUTOVER: framework knobs are sourced ONLY from defaults + `.config`. Any
// such keys still sitting in an existing `project-profile.yaml` are ignored on
// read and stripped on write. `.config.example` is the discoverability surface
// and is NEVER read at runtime.
//
// A single `FRAMEWORK_CONFIG_SPECS` table is the one source of truth: it drives
// the defaults, the parser, the in-memory overlay, and the generated example
// file, so the three can never drift (a test asserts the example round-trips).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

/** Tokens that mean boolean true / false in a `.config` value (case-insensitive). */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

type ConfigValueType = 'boolean' | 'number' | 'string' | 'enum';

export interface FrameworkConfigSpec {
  /** Flat KEY as written in `.config` / `.config.example`. */
  key: string;
  type: ConfigValueType;
  /** The built-in default (the value when `.config` is absent or silent). */
  default: boolean | number | string | undefined;
  /** Allowed values for `type: 'enum'`. */
  enumValues?: readonly string[];
  /** When true, an unset/empty value resolves to `undefined`, not the default. */
  optional?: boolean;
  /** Section header this key is grouped under in `.config.example`. */
  section: string;
  /** One-line explanation rendered as a comment in `.config.example`. */
  comment: string;
  /** Render the example line commented-out (for optional, default-unset keys). */
  exampleCommented?: boolean;
}

// ── The one source of truth ────────────────────────────────────────────────
// Order here is the order rendered into `.config.example`.
export const FRAMEWORK_CONFIG_SPECS: readonly FrameworkConfigSpec[] = [
  // Framework master switch
  {
    key: 'PAQAD_ENABLED',
    type: 'boolean',
    default: true,
    section: 'Framework master switch',
    comment: 'Turn paqad off entirely (vanilla mode). Absent/true = on.',
  },

  // Version & updates
  {
    key: 'AUTO_UPDATE',
    type: 'boolean',
    default: true,
    section: 'Version & updates',
    comment: 'Pull newer framework versions in the background on session start.',
  },
  {
    key: 'MINIMUM_VERSION',
    type: 'string',
    default: 'latest',
    section: 'Version & updates',
    comment:
      'Refuse to run below this version. "latest" = no fixed floor, track newest. Or pin e.g. 1.28.1.',
  },
  {
    key: 'VERSION_CHECK_INTERVAL_HOURS',
    type: 'number',
    default: 12,
    section: 'Version & updates',
    comment: 'How often the background version check runs.',
  },

  // Enterprise / governance (licensed, off by default)
  {
    key: 'ENTERPRISE_ENABLED',
    type: 'boolean',
    default: false,
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Master switch for the enterprise/governance capabilities.',
  },
  {
    key: 'ENTERPRISE_EVIDENCE_LEDGER',
    type: 'boolean',
    default: false,
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Write the receipt + evidence ledger set under .paqad/ledger/.',
  },
  {
    key: 'ENTERPRISE_AI_BOM',
    type: 'boolean',
    default: false,
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Write the CycloneDX ai-bom.json view.',
  },
  {
    key: 'ENTERPRISE_COMPLIANCE_CITATIONS',
    type: 'boolean',
    default: false,
    section: 'Enterprise / governance (licensed, off by default)',
    comment: 'Resolve framework citations into the receipt (token-spending path).',
  },

  // Intelligence / RAG
  {
    key: 'RAG_ENABLED',
    type: 'boolean',
    default: false,
    section: 'Intelligence / RAG',
    comment: 'Enable retrieval-augmented context loading.',
  },
  {
    key: 'RAG_EMBEDDING_PROVIDER',
    type: 'enum',
    enumValues: EMBEDDING_PROVIDERS,
    default: undefined,
    optional: true,
    exampleCommented: true,
    section: 'Intelligence / RAG',
    comment: 'local | openai | voyageai. Unset uses the local model.',
  },
  {
    key: 'RAG_EMBEDDING_MODEL',
    type: 'string',
    default: undefined,
    optional: true,
    exampleCommented: true,
    section: 'Intelligence / RAG',
    comment: 'Override the embedding model id. Unset = provider default.',
  },
  {
    key: 'RAG_SIMILARITY_THRESHOLD',
    type: 'number',
    default: 0.75,
    section: 'Intelligence / RAG',
    comment: 'Minimum cosine similarity for a chunk to be retrieved.',
  },
  {
    key: 'RAG_TOP_N',
    type: 'number',
    default: 20,
    section: 'Intelligence / RAG',
    comment: 'Max chunks retrieved per query.',
  },
  {
    key: 'RAG_MAX_FILE_SIZE',
    type: 'number',
    default: 153600,
    section: 'Intelligence / RAG',
    comment: 'Skip indexing files larger than this many bytes.',
  },

  // Strictness / quality gates
  {
    key: 'FULL_LANE_DEFAULT',
    type: 'boolean',
    default: false,
    section: 'Strictness / quality gates',
    comment: 'Route every task through the full (heaviest) lane by default.',
  },
  {
    key: 'REQUIRE_ADVERSARIAL_REVIEW',
    type: 'boolean',
    default: true,
    section: 'Strictness / quality gates',
    comment: 'Require an adversarial review pass before delivery.',
  },
  {
    key: 'BLOCK_ON_STALE_DOCS',
    type: 'boolean',
    default: true,
    section: 'Strictness / quality gates',
    comment: 'Block delivery when canonical docs are out of date.',
  },
  {
    key: 'REQUIRE_DB_REVIEW_FOR_MIGRATIONS',
    type: 'boolean',
    default: true,
    section: 'Strictness / quality gates',
    comment: 'Require a database review when a change includes migrations.',
  },

  // Escalation policy
  {
    key: 'ESCALATE_DESTRUCTIVE_OPERATIONS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'block',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for destructive operations.',
  },
  {
    key: 'ESCALATE_RISKY_MIGRATIONS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'warn',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for risky migrations.',
  },
  {
    key: 'ESCALATE_SECURITY_FINDINGS',
    type: 'enum',
    enumValues: ESCALATION_MODES,
    default: 'block',
    section: 'Escalation policy',
    comment: 'block | require_approval | warn — for security findings.',
  },
  {
    key: 'ESCALATE_DB_ROW_THRESHOLD',
    type: 'number',
    default: 10000,
    section: 'Escalation policy',
    comment: 'Row count above which a data operation escalates.',
  },

  // Feature flags
  {
    key: 'FEATURE_SPEC_ONLY_MODE',
    type: 'boolean',
    default: false,
    section: 'Feature flags',
    comment: 'Stop after the spec phase; do not implement.',
  },
  {
    key: 'FEATURE_MARKET_RESEARCH',
    type: 'boolean',
    default: false,
    section: 'Feature flags',
    comment: 'Enable the market-research agent in planning.',
  },
  {
    key: 'FEATURE_DESIGN_RESEARCH',
    type: 'boolean',
    default: false,
    section: 'Feature flags',
    comment: 'Enable the design-research agent in planning.',
  },
  {
    key: 'FEATURE_TEAM_AGENTS',
    type: 'boolean',
    default: true,
    section: 'Feature flags',
    comment: 'Use the multi-agent team for full-lane work.',
  },

  // Research & model routing
  {
    key: 'RESEARCH_DEPTH',
    type: 'enum',
    enumValues: RESEARCH_DEPTHS,
    default: 'standard',
    section: 'Research & model routing',
    comment: 'cutting-edge | standard | conservative.',
  },
  {
    key: 'MODEL_DEFAULT',
    type: 'string',
    default: 'gpt-5',
    section: 'Research & model routing',
    comment: 'Default model for routine work.',
  },
  {
    key: 'MODEL_REASONING',
    type: 'string',
    default: 'gpt-5',
    section: 'Research & model routing',
    comment: 'Model for heavy reasoning / planning.',
  },
  {
    key: 'MODEL_FAST',
    type: 'string',
    default: 'gpt-5-mini',
    section: 'Research & model routing',
    comment: 'Cheap/fast model for lightweight steps.',
  },

  // Decisions (pause-contract tuning)
  {
    key: 'DECISIONS_ASK_THRESHOLD',
    type: 'enum',
    enumValues: ASK_THRESHOLDS,
    default: 'balanced',
    section: 'Decisions (pause-contract tuning)',
    comment: 'strict | balanced | permissive — how eagerly to pause and ask.',
  },
  {
    key: 'DECISIONS_MAX_SCREENS_PER_TASK',
    type: 'number',
    default: 3,
    section: 'Decisions (pause-contract tuning)',
    comment: 'Max decision screens surfaced per task.',
  },
  {
    key: 'DECISIONS_IDLE_TIMEOUT_MINUTES',
    type: 'number',
    default: 30,
    section: 'Decisions (pause-contract tuning)',
    comment: 'Auto-resolve a pending decision after this idle window.',
  },
] as const;

const SPEC_BY_KEY = new Map<string, FrameworkConfigSpec>(
  FRAMEWORK_CONFIG_SPECS.map((spec) => [spec.key, spec]),
);

// Framework-internal efficiency tuning (Bucket C): never surfaced in
// `.config.example`, never team-tuned. Lives here so the in-memory profile is
// complete for readers; overridable only via the escape hatch below.
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
 * Parse flat `KEY=VALUE` `.config` text into a map. Rules (Laravel `.env`-ish):
 * - Blank lines and full-line `#` comments are ignored.
 * - A line without `=` is ignored (not an assignment).
 * - `export KEY=...` is tolerated (the `export ` prefix is dropped).
 * - Quoted values (`"..."` / `'...'`) are taken verbatim, inner content only.
 * - Unquoted values are trimmed and an inline ` # comment` is stripped.
 * - Duplicate keys: last assignment wins.
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

/** Read and parse `.paqad/.config`; an absent/unreadable file yields an empty map. */
export function readDotConfig(projectRoot: string): Map<string, string> {
  try {
    return parseDotConfig(readFileSync(join(projectRoot, PATHS.PROJECT_CONFIG), 'utf8'));
  } catch {
    return new Map();
  }
}

/**
 * Raw, side-effect-free read of the off-signal in `.paqad/.config`. True iff
 * `PAQAD_ENABLED` is present and resolves to a falsy token (`false`/`0`/`no`/
 * `off`). Absent, truthy, or unrecognised ⇒ false (not disabled). Mirrors the
 * dist-less `paqad-disabled.{sh,mjs}` primitives so all three agree on "off".
 */
export function configSaysPaqadDisabled(projectRoot: string): boolean {
  const raw = readDotConfig(projectRoot).get('PAQAD_ENABLED');
  return raw !== undefined && FALSY.has(raw.trim().toLowerCase());
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Upsert a single `KEY=value` assignment in `.paqad/.config`, preserving every
 * other line, comment, and the ordering. Replaces the first uncommented
 * assignment of `key` if present; otherwise appends. Creates the file (and
 * `.paqad/`) when absent. This is the write behind `paqad-ai enable/disable`.
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

/** Resolve framework config from an already-parsed `.config` map. */
export function resolveFrameworkConfigFromMap(raw: Map<string, string>): ResolvedFrameworkConfig {
  const rb = (key: string): boolean => asBool(raw.get(key), defOf(key) as boolean);
  const rn = (key: string): number => asNum(raw.get(key), defOf(key) as number);
  const rs = (key: string): string => asStr(raw.get(key), defOf(key) as string);

  const provider = asOptEnum(raw.get('RAG_EMBEDDING_PROVIDER'), EMBEDDING_PROVIDERS);
  const embeddingModel = raw.get('RAG_EMBEDDING_MODEL')?.trim() || undefined;

  const intelligence = normalizeIntelligenceConfig({
    rag_enabled: rb('RAG_ENABLED'),
    embedding_provider: provider,
    embedding_model: embeddingModel,
    rag_similarity_threshold: rn('RAG_SIMILARITY_THRESHOLD'),
    rag_top_n: rn('RAG_TOP_N'),
    rag_max_file_size: rn('RAG_MAX_FILE_SIZE'),
  });

  return {
    paqad: { enabled: rb('PAQAD_ENABLED') },
    enterprise: {
      enabled: rb('ENTERPRISE_ENABLED'),
      evidence_ledger: rb('ENTERPRISE_EVIDENCE_LEDGER'),
      ai_bom: rb('ENTERPRISE_AI_BOM'),
      compliance_citations: rb('ENTERPRISE_COMPLIANCE_CITATIONS'),
    },
    intelligence,
    strictness: {
      full_lane_default: rb('FULL_LANE_DEFAULT'),
      require_adversarial_review: rb('REQUIRE_ADVERSARIAL_REVIEW'),
      block_on_stale_docs: rb('BLOCK_ON_STALE_DOCS'),
      require_db_review_for_migrations: rb('REQUIRE_DB_REVIEW_FOR_MIGRATIONS'),
    },
    escalation: {
      destructive_operations: asEnum(
        raw.get('ESCALATE_DESTRUCTIVE_OPERATIONS'),
        ESCALATION_MODES,
        defOf('ESCALATE_DESTRUCTIVE_OPERATIONS') as EscalationMode,
      ),
      risky_migrations: asEnum(
        raw.get('ESCALATE_RISKY_MIGRATIONS'),
        ESCALATION_MODES,
        defOf('ESCALATE_RISKY_MIGRATIONS') as EscalationMode,
      ),
      security_findings: asEnum(
        raw.get('ESCALATE_SECURITY_FINDINGS'),
        ESCALATION_MODES,
        defOf('ESCALATE_SECURITY_FINDINGS') as EscalationMode,
      ),
      db_row_threshold: rn('ESCALATE_DB_ROW_THRESHOLD'),
    },
    features: {
      spec_only_mode: rb('FEATURE_SPEC_ONLY_MODE'),
      market_research: rb('FEATURE_MARKET_RESEARCH'),
      design_research: rb('FEATURE_DESIGN_RESEARCH'),
      team_agents: rb('FEATURE_TEAM_AGENTS'),
    },
    research: {
      depth: asEnum(
        raw.get('RESEARCH_DEPTH'),
        RESEARCH_DEPTHS,
        defOf('RESEARCH_DEPTH') as ResearchDepth,
      ),
    },
    model_routing: {
      default_model: rs('MODEL_DEFAULT'),
      reasoning_model: rs('MODEL_REASONING'),
      fast_model: rs('MODEL_FAST'),
    },
    decisions: {
      ask_threshold: asEnum(
        raw.get('DECISIONS_ASK_THRESHOLD'),
        ASK_THRESHOLDS,
        defOf('DECISIONS_ASK_THRESHOLD') as DecisionProfileConfig['ask_threshold'] & string,
      ),
      max_screens_per_task: rn('DECISIONS_MAX_SCREENS_PER_TASK'),
      idle_timeout_minutes: rn('DECISIONS_IDLE_TIMEOUT_MINUTES'),
    },
    efficiency: {
      ...DEFAULT_EFFICIENCY_TUNING,
      auto_update: rb('AUTO_UPDATE'),
      minimum_version: rs('MINIMUM_VERSION'),
      version_check_interval_hours: rn('VERSION_CHECK_INTERVAL_HOURS'),
    },
  };
}

/** Resolve framework config for a project root (reads `.paqad/.config`). */
export function resolveFrameworkConfig(projectRoot: string): ResolvedFrameworkConfig {
  return resolveFrameworkConfigFromMap(readDotConfig(projectRoot));
}

/** The all-defaults resolution (no `.config` present). */
export const DEFAULT_FRAMEWORK_CONFIG: ResolvedFrameworkConfig = resolveFrameworkConfigFromMap(
  new Map(),
);

// ── Overlay / strip (the storage seam) ─────────────────────────────────────

// The `custom.decisions` sub-keys owned by the `.config` layer (the simple,
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
      // Merge the `.config`-owned simple knobs OVER the project-specific advanced
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
    // Drop only the `.config`-owned simple knobs from `decisions`; keep any
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

// ── `.config.example` generation ───────────────────────────────────────────

function exampleValue(spec: FrameworkConfigSpec): string {
  if (spec.default === undefined) {
    return '';
  }
  return String(spec.default);
}

/**
 * Render the tracked, commented `.config.example`. Driven entirely by
 * `FRAMEWORK_CONFIG_SPECS`, so it always matches the resolver (asserted by test).
 */
export function generateConfigExample(): string {
  const lines: string[] = [
    '# paqad framework configuration (.paqad/.config.example)',
    '#',
    '# Copy to `.paqad/.config` and uncomment any line to override a default.',
    '# `.config` is git-ignored (share it with your team out of band, like .env).',
    '# Every value below is the built-in default — deleting `.config` restores it.',
    '# This .example file is documentation only and is never read at runtime.',
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
    lines.push(`# ${spec.comment}`);
    const assignment = `${spec.key}=${exampleValue(spec)}`;
    lines.push(spec.exampleCommented ? `# ${assignment}` : assignment);
  }

  lines.push('');
  return lines.join('\n');
}

/** Write the tracked `.paqad/.config.example` template. Always refreshed (like
 *  Laravel's `.env.example`) so newly-shipped keys appear after an update. */
export function writeConfigExample(projectRoot: string): string {
  const path = join(projectRoot, PATHS.PROJECT_CONFIG_EXAMPLE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateConfigExample(), 'utf8');
  return path;
}

/**
 * Map the framework sections of a (partial) profile to the flat `.config` keys
 * whose value DIFFERS from the built-in default. Used to persist explicit
 * overrides (desktop onboarding, the dashboard) into `.config` without
 * materializing the full default set.
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
    put('PAQAD_ENABLED', overrides.paqad.enabled, d.paqad.enabled);
  }
  if (overrides.enterprise) {
    put('ENTERPRISE_ENABLED', overrides.enterprise.enabled, d.enterprise.enabled);
    put(
      'ENTERPRISE_EVIDENCE_LEDGER',
      overrides.enterprise.evidence_ledger,
      d.enterprise.evidence_ledger,
    );
    put('ENTERPRISE_AI_BOM', overrides.enterprise.ai_bom, d.enterprise.ai_bom);
    put(
      'ENTERPRISE_COMPLIANCE_CITATIONS',
      overrides.enterprise.compliance_citations,
      d.enterprise.compliance_citations,
    );
  }
  if (overrides.intelligence) {
    const i = overrides.intelligence;
    put('RAG_ENABLED', i.rag_enabled, d.intelligence.rag_enabled);
    put('RAG_EMBEDDING_PROVIDER', i.embedding_provider, d.intelligence.embedding_provider);
    put('RAG_EMBEDDING_MODEL', i.embedding_model, d.intelligence.embedding_model);
    put(
      'RAG_SIMILARITY_THRESHOLD',
      i.rag_similarity_threshold,
      d.intelligence.rag_similarity_threshold,
    );
    put('RAG_TOP_N', i.rag_top_n, d.intelligence.rag_top_n);
    put('RAG_MAX_FILE_SIZE', i.rag_max_file_size, d.intelligence.rag_max_file_size);
  }
  if (overrides.strictness) {
    const s = overrides.strictness;
    put('FULL_LANE_DEFAULT', s.full_lane_default, d.strictness.full_lane_default);
    put(
      'REQUIRE_ADVERSARIAL_REVIEW',
      s.require_adversarial_review,
      d.strictness.require_adversarial_review,
    );
    put('BLOCK_ON_STALE_DOCS', s.block_on_stale_docs, d.strictness.block_on_stale_docs);
    put(
      'REQUIRE_DB_REVIEW_FOR_MIGRATIONS',
      s.require_db_review_for_migrations,
      d.strictness.require_db_review_for_migrations,
    );
  }
  if (overrides.escalation) {
    const e = overrides.escalation;
    put(
      'ESCALATE_DESTRUCTIVE_OPERATIONS',
      e.destructive_operations,
      d.escalation.destructive_operations,
    );
    put('ESCALATE_RISKY_MIGRATIONS', e.risky_migrations, d.escalation.risky_migrations);
    put('ESCALATE_SECURITY_FINDINGS', e.security_findings, d.escalation.security_findings);
    put('ESCALATE_DB_ROW_THRESHOLD', e.db_row_threshold, d.escalation.db_row_threshold);
  }
  if (overrides.features) {
    const f = overrides.features;
    put('FEATURE_SPEC_ONLY_MODE', f.spec_only_mode, d.features.spec_only_mode);
    put('FEATURE_MARKET_RESEARCH', f.market_research, d.features.market_research);
    put('FEATURE_DESIGN_RESEARCH', f.design_research, d.features.design_research);
    put('FEATURE_TEAM_AGENTS', f.team_agents, d.features.team_agents);
  }
  if (overrides.research) {
    put('RESEARCH_DEPTH', overrides.research.depth, d.research.depth);
  }
  if (overrides.model_routing) {
    const m = overrides.model_routing;
    put('MODEL_DEFAULT', m.default_model, d.model_routing.default_model);
    put('MODEL_REASONING', m.reasoning_model, d.model_routing.reasoning_model);
    put('MODEL_FAST', m.fast_model, d.model_routing.fast_model);
  }
  if (overrides.custom?.decisions) {
    const dec = overrides.custom.decisions;
    put('DECISIONS_ASK_THRESHOLD', dec.ask_threshold, d.decisions.ask_threshold);
    put(
      'DECISIONS_MAX_SCREENS_PER_TASK',
      dec.max_screens_per_task,
      d.decisions.max_screens_per_task,
    );
    put(
      'DECISIONS_IDLE_TIMEOUT_MINUTES',
      dec.idle_timeout_minutes,
      d.decisions.idle_timeout_minutes,
    );
  }
  if (overrides.efficiency) {
    const ef = overrides.efficiency;
    put('AUTO_UPDATE', ef.auto_update, d.efficiency.auto_update);
    put('MINIMUM_VERSION', ef.minimum_version, d.efficiency.minimum_version);
    put(
      'VERSION_CHECK_INTERVAL_HOURS',
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
 * Which `.config` keys belong to which profile section, and how to tell that
 * section is present on a (partial) profile. Drives the authoritative sync below
 * so a partial profile only touches its own sections. A test asserts this covers
 * every spec key exactly once, so it cannot drift from FRAMEWORK_CONFIG_SPECS.
 */
export const CONFIG_KEY_SECTIONS: ReadonlyArray<{
  present: (p: Partial<ProjectProfile>) => boolean;
  keys: readonly string[];
}> = [
  { present: (p) => p.paqad !== undefined, keys: ['PAQAD_ENABLED'] },
  {
    present: (p) => p.enterprise !== undefined,
    keys: [
      'ENTERPRISE_ENABLED',
      'ENTERPRISE_EVIDENCE_LEDGER',
      'ENTERPRISE_AI_BOM',
      'ENTERPRISE_COMPLIANCE_CITATIONS',
    ],
  },
  {
    present: (p) => p.intelligence !== undefined,
    keys: [
      'RAG_ENABLED',
      'RAG_EMBEDDING_PROVIDER',
      'RAG_EMBEDDING_MODEL',
      'RAG_SIMILARITY_THRESHOLD',
      'RAG_TOP_N',
      'RAG_MAX_FILE_SIZE',
    ],
  },
  {
    present: (p) => p.strictness !== undefined,
    keys: [
      'FULL_LANE_DEFAULT',
      'REQUIRE_ADVERSARIAL_REVIEW',
      'BLOCK_ON_STALE_DOCS',
      'REQUIRE_DB_REVIEW_FOR_MIGRATIONS',
    ],
  },
  {
    present: (p) => p.escalation !== undefined,
    keys: [
      'ESCALATE_DESTRUCTIVE_OPERATIONS',
      'ESCALATE_RISKY_MIGRATIONS',
      'ESCALATE_SECURITY_FINDINGS',
      'ESCALATE_DB_ROW_THRESHOLD',
    ],
  },
  {
    present: (p) => p.features !== undefined,
    keys: [
      'FEATURE_SPEC_ONLY_MODE',
      'FEATURE_MARKET_RESEARCH',
      'FEATURE_DESIGN_RESEARCH',
      'FEATURE_TEAM_AGENTS',
    ],
  },
  { present: (p) => p.research !== undefined, keys: ['RESEARCH_DEPTH'] },
  {
    present: (p) => p.model_routing !== undefined,
    keys: ['MODEL_DEFAULT', 'MODEL_REASONING', 'MODEL_FAST'],
  },
  {
    present: (p) => p.custom?.decisions !== undefined,
    keys: [
      'DECISIONS_ASK_THRESHOLD',
      'DECISIONS_MAX_SCREENS_PER_TASK',
      'DECISIONS_IDLE_TIMEOUT_MINUTES',
    ],
  },
  {
    present: (p) => p.efficiency !== undefined,
    keys: ['AUTO_UPDATE', 'MINIMUM_VERSION', 'VERSION_CHECK_INTERVAL_HOURS'],
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
