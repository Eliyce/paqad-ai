import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import {
  CONFIG_KEY_SECTIONS,
  DEFAULT_FRAMEWORK_CONFIG,
  FRAMEWORK_CONFIG_SPECS,
  applyFrameworkConfigToProfile,
  configSaysPaqadDisabled,
  frameworkOverridesToFlat,
  generateConfigExample,
  parseDotConfig,
  readDotConfig,
  removeConfigValue,
  resolveFrameworkConfig,
  resolveFrameworkConfigFromMap,
  setConfigValue,
  stripFrameworkConfigFromProfile,
  syncFrameworkConfig,
  writeConfigExample,
} from '@/core/framework-config.js';
import { readProjectProfile, writeProjectProfile } from '@/core/project-profile.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-fwcfg-'));
}

function writeConfig(root: string, body: string): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', '.config'), body, 'utf8');
}

/** A minimal valid in-memory profile (project facts only). */
function baseProfile(overrides: Partial<ProjectProfile> = {}): ProjectProfile {
  return {
    project: { name: 'demo', id: 'demo', description: 'x' },
    active_capabilities: ['content'],
    commands: {
      install: 'i',
      dev: 'd',
      test: 't',
      test_single: 'ts',
      lint: 'l',
      format: 'f',
      migrate: 'm',
      build: 'b',
    },
    compliance_packs: [],
    mcp: { servers: [] },
    custom: {
      classification_dimensions: [],
      verification_plugins: [],
      escalation_rules: [],
    },
    ...overrides,
  } as ProjectProfile;
}

describe('parseDotConfig', () => {
  it('parses simple KEY=VALUE pairs', () => {
    const m = parseDotConfig('RAG_TOP_N=42\nMODEL_DEFAULT=gpt-x');
    expect(m.get('RAG_TOP_N')).toBe('42');
    expect(m.get('MODEL_DEFAULT')).toBe('gpt-x');
  });

  it('ignores blank lines and full-line comments', () => {
    const m = parseDotConfig('\n# a comment\n   \n# another\nPAQAD_ENABLED=false\n');
    expect(m.size).toBe(1);
    expect(m.get('PAQAD_ENABLED')).toBe('false');
  });

  it('ignores lines without an = sign', () => {
    expect(parseDotConfig('this is not config').size).toBe(0);
  });

  it('tolerates an `export ` prefix', () => {
    expect(parseDotConfig('export RAG_ENABLED=true').get('RAG_ENABLED')).toBe('true');
  });

  it('takes quoted values verbatim (no inline-comment stripping inside quotes)', () => {
    expect(parseDotConfig('MODEL_DEFAULT="gpt-5 # turbo"').get('MODEL_DEFAULT')).toBe(
      'gpt-5 # turbo',
    );
    expect(parseDotConfig("MODEL_FAST='mini'").get('MODEL_FAST')).toBe('mini');
  });

  it('strips an inline comment from unquoted values', () => {
    expect(parseDotConfig('RAG_TOP_N=20 # default').get('RAG_TOP_N')).toBe('20');
  });

  it('handles CRLF line endings', () => {
    const m = parseDotConfig('A=1\r\nRAG_TOP_N=9\r\n');
    expect(m.get('RAG_TOP_N')).toBe('9');
  });

  it('lets the last duplicate key win', () => {
    expect(parseDotConfig('RAG_TOP_N=1\nRAG_TOP_N=2').get('RAG_TOP_N')).toBe('2');
  });

  it('trims whitespace around keys and unquoted values', () => {
    expect(parseDotConfig('  RAG_TOP_N  =  7  ').get('RAG_TOP_N')).toBe('7');
  });
});

describe('resolveFrameworkConfigFromMap — coercion + precedence', () => {
  it('returns documented defaults for an empty config', () => {
    const c = DEFAULT_FRAMEWORK_CONFIG;
    expect(c.paqad.enabled).toBe(true);
    expect(c.enterprise.enabled).toBe(false);
    expect(c.intelligence.rag_enabled).toBe(false);
    expect(c.intelligence.rag_top_n).toBe(20);
    expect(c.strictness.require_adversarial_review).toBe(true);
    expect(c.escalation.destructive_operations).toBe('block');
    expect(c.escalation.risky_migrations).toBe('warn');
    expect(c.features.team_agents).toBe(true);
    expect(c.research.depth).toBe('standard');
    expect(c.model_routing.default_model).toBe('gpt-5');
    expect(c.decisions.ask_threshold).toBe('balanced');
    expect(c.efficiency.auto_update).toBe(true);
    expect(c.efficiency.minimum_version).toBe('latest');
    expect(c.efficiency.version_check_interval_hours).toBe(12);
  });

  it('overrides defaults from the config map (precedence)', () => {
    const c = resolveFrameworkConfigFromMap(
      parseDotConfig(
        'PAQAD_ENABLED=false\nRAG_ENABLED=true\nRAG_TOP_N=5\nRESEARCH_DEPTH=cutting-edge',
      ),
    );
    expect(c.paqad.enabled).toBe(false);
    expect(c.intelligence.rag_enabled).toBe(true);
    expect(c.intelligence.rag_top_n).toBe(5);
    expect(c.research.depth).toBe('cutting-edge');
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on', 'On'])('coerces %s to boolean true', (v) => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig(`RAG_ENABLED=${v}`)).intelligence.rag_enabled,
    ).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', 'OFF'])('coerces %s to boolean false', (v) => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig(`FEATURE_TEAM_AGENTS=${v}`)).features
        .team_agents,
    ).toBe(false);
  });

  it('falls back to the default for an invalid boolean', () => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig('REQUIRE_ADVERSARIAL_REVIEW=maybe')).strictness
        .require_adversarial_review,
    ).toBe(true);
  });

  it('falls back to the default for a non-numeric number', () => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig('RAG_TOP_N=lots')).intelligence.rag_top_n,
    ).toBe(20);
  });

  it('falls back to the default for an out-of-enum value', () => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig('RESEARCH_DEPTH=ludicrous')).research.depth,
    ).toBe('standard');
  });

  it('leaves the optional embedding provider/model unset by default', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.intelligence.embedding_provider).toBeUndefined();
    expect(DEFAULT_FRAMEWORK_CONFIG.intelligence.embedding_model).toBeUndefined();
  });

  it('honors an explicit embedding provider', () => {
    const c = resolveFrameworkConfigFromMap(
      parseDotConfig('RAG_ENABLED=true\nRAG_EMBEDDING_PROVIDER=openai'),
    );
    expect(c.intelligence.embedding_provider).toBe('openai');
  });

  it('still fills framework-internal RAG tuning (bucket C) from code defaults', () => {
    const c = DEFAULT_FRAMEWORK_CONFIG;
    expect(c.intelligence.benchmark_gates?.hit_at_5_improvement_pct).toBe(20);
    expect(c.intelligence.adaptive_retrieval?.enabled).toBe(true);
  });
});

describe('applyFrameworkConfigToProfile — overlay + hard cutover', () => {
  it('overlays every framework section onto a lean base profile', () => {
    const profile = applyFrameworkConfigToProfile(
      baseProfile(),
      resolveFrameworkConfigFromMap(parseDotConfig('RAG_ENABLED=true\nENTERPRISE_ENABLED=true')),
    );
    expect(profile.intelligence.rag_enabled).toBe(true);
    expect(profile.enterprise?.enabled).toBe(true);
    expect(profile.strictness.block_on_stale_docs).toBe(true);
    expect(profile.custom.decisions?.ask_threshold).toBe('balanced');
  });

  it('replaces stale framework keys carried on the base (hard cutover)', () => {
    const stale = baseProfile({
      intelligence: { rag_enabled: true, rag_similarity_threshold: 0.1, rag_top_n: 99 },
      paqad: { enabled: false },
    } as Partial<ProjectProfile>);
    const profile = applyFrameworkConfigToProfile(stale, DEFAULT_FRAMEWORK_CONFIG);
    expect(profile.intelligence.rag_enabled).toBe(false); // YAML value ignored
    expect(profile.intelligence.rag_top_n).toBe(20);
    expect(profile.paqad?.enabled).toBe(true);
  });

  it('preserves project-owned custom arrays while overlaying custom.decisions', () => {
    const withCustom = baseProfile({
      custom: {
        classification_dimensions: [{ name: 'risk' }],
        verification_plugins: [],
        escalation_rules: [],
        decisions: { ask_threshold: 'strict' },
      },
    } as Partial<ProjectProfile>);
    const profile = applyFrameworkConfigToProfile(withCustom, DEFAULT_FRAMEWORK_CONFIG);
    expect(profile.custom.classification_dimensions).toHaveLength(1);
    expect(profile.custom.decisions?.ask_threshold).toBe('balanced'); // overlaid, not YAML's 'strict'
  });
});

describe('stripFrameworkConfigFromProfile — lean write', () => {
  it('removes every framework section and custom.decisions, keeps project facts', () => {
    const full = applyFrameworkConfigToProfile(baseProfile(), DEFAULT_FRAMEWORK_CONFIG);
    const lean = stripFrameworkConfigFromProfile(full) as Record<string, unknown>;
    expect(lean.project).toBeDefined();
    expect(lean.commands).toBeDefined();
    expect(lean.mcp).toBeDefined();
    expect(lean.paqad).toBeUndefined();
    expect(lean.enterprise).toBeUndefined();
    expect(lean.intelligence).toBeUndefined();
    expect(lean.strictness).toBeUndefined();
    expect(lean.escalation).toBeUndefined();
    expect(lean.features).toBeUndefined();
    expect(lean.research).toBeUndefined();
    expect(lean.model_routing).toBeUndefined();
    expect(lean.efficiency).toBeUndefined();
    expect((lean.custom as Record<string, unknown>).decisions).toBeUndefined();
    expect((lean.custom as Record<string, unknown>).classification_dimensions).toBeDefined();
  });
});

describe('readDotConfig', () => {
  it('returns an empty map when .config is absent', () => {
    const root = tmpRoot();
    try {
      expect(readDotConfig(root).size).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads and parses an on-disk .config', () => {
    const root = tmpRoot();
    try {
      writeConfig(root, 'RAG_TOP_N=3\n');
      expect(resolveFrameworkConfig(root).intelligence.rag_top_n).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('generateConfigExample — discoverability surface stays in sync', () => {
  const example = generateConfigExample();

  it('documents every spec key', () => {
    for (const spec of FRAMEWORK_CONFIG_SPECS) {
      expect(example).toContain(spec.key);
    }
  });

  it('round-trips: the example’s active lines resolve back to the defaults', () => {
    const resolved = resolveFrameworkConfigFromMap(parseDotConfig(example));
    expect(resolved).toEqual(DEFAULT_FRAMEWORK_CONFIG);
  });

  it('comments out optional, default-unset keys', () => {
    expect(example).toMatch(/^# RAG_EMBEDDING_PROVIDER=/m);
    expect(example).toMatch(/^# RAG_EMBEDDING_MODEL=/m);
  });

  it('keeps the two new version knobs front and centre', () => {
    expect(example).toMatch(/^AUTO_UPDATE=true$/m);
    expect(example).toMatch(/^MINIMUM_VERSION=latest$/m);
  });
});

describe('integration — readProjectProfile / writeProjectProfile', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes a LEAN profile: framework keys never reach the YAML', () => {
    writeProjectProfile(
      root,
      applyFrameworkConfigToProfile(baseProfile(), DEFAULT_FRAMEWORK_CONFIG),
    );
    const onDisk = YAML.parse(readFileSync(join(root, '.paqad', 'project-profile.yaml'), 'utf8'));
    expect(onDisk.intelligence).toBeUndefined();
    expect(onDisk.strictness).toBeUndefined();
    expect(onDisk.paqad).toBeUndefined();
    expect(onDisk.project).toBeDefined();
  });

  it('hard cutover: a legacy fat YAML’s framework values are ignored on read', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    // Simulate an old profile that still has framework knobs inline.
    const fat = {
      ...baseProfile(),
      intelligence: { rag_enabled: true, rag_similarity_threshold: 0.9, rag_top_n: 77 },
      strictness: {
        full_lane_default: true,
        require_adversarial_review: false,
        block_on_stale_docs: false,
        require_db_review_for_migrations: false,
      },
    };
    writeFileSync(join(root, '.paqad', 'project-profile.yaml'), YAML.stringify(fat), 'utf8');
    const profile = readProjectProfile(root)!;
    expect(profile.intelligence.rag_enabled).toBe(false); // defaulted, not 77/0.9/true
    expect(profile.intelligence.rag_top_n).toBe(20);
    expect(profile.strictness.require_adversarial_review).toBe(true);
  });

  it('a .config override is reflected in the in-memory profile', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'project-profile.yaml'),
      YAML.stringify(baseProfile()),
      'utf8',
    );
    writeConfig(root, 'RAG_ENABLED=true\nENTERPRISE_ENABLED=true\n');
    const profile = readProjectProfile(root)!;
    expect(profile.intelligence.rag_enabled).toBe(true);
    expect(profile.enterprise?.enabled).toBe(true);
  });
});

describe('setConfigValue / removeConfigValue — the write path', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const configPath = (): string => join(root, '.paqad', '.config');

  it('creates the file when absent', () => {
    setConfigValue(root, 'PAQAD_ENABLED', 'false');
    expect(readFileSync(configPath(), 'utf8')).toMatch(/^PAQAD_ENABLED=false$/m);
  });

  it('replaces an existing assignment, preserving other lines and comments', () => {
    writeConfig(root, '# header\nRAG_TOP_N=20\nMODEL_DEFAULT=gpt-5\n');
    setConfigValue(root, 'RAG_TOP_N', '99');
    const out = readFileSync(configPath(), 'utf8');
    expect(out).toMatch(/^RAG_TOP_N=99$/m);
    expect(out).toContain('# header');
    expect(out).toMatch(/^MODEL_DEFAULT=gpt-5$/m);
    expect(out).not.toContain('RAG_TOP_N=20');
  });

  it('does not overwrite a commented-out key (appends instead)', () => {
    writeConfig(root, '# RAG_TOP_N=20\n');
    setConfigValue(root, 'RAG_TOP_N', '5');
    const out = readFileSync(configPath(), 'utf8');
    expect(out).toContain('# RAG_TOP_N=20');
    expect(out).toMatch(/^RAG_TOP_N=5$/m);
  });

  it('removeConfigValue deletes the key but keeps comments and other keys', () => {
    writeConfig(root, '# keep\nRAG_TOP_N=5\nMODEL_FAST=mini\n');
    removeConfigValue(root, 'RAG_TOP_N');
    const out = readFileSync(configPath(), 'utf8');
    expect(out).not.toMatch(/^RAG_TOP_N=/m);
    expect(out).toContain('# keep');
    expect(out).toMatch(/^MODEL_FAST=mini$/m);
  });

  it('removeConfigValue is a no-op when .config is absent', () => {
    expect(() => removeConfigValue(root, 'RAG_TOP_N')).not.toThrow();
  });

  it('configSaysPaqadDisabled tracks the .config off-signal', () => {
    expect(configSaysPaqadDisabled(root)).toBe(false); // absent
    setConfigValue(root, 'PAQAD_ENABLED', 'false');
    expect(configSaysPaqadDisabled(root)).toBe(true);
    setConfigValue(root, 'PAQAD_ENABLED', 'true');
    expect(configSaysPaqadDisabled(root)).toBe(false);
    setConfigValue(root, 'PAQAD_ENABLED', 'banana'); // unrecognised ⇒ not disabled
    expect(configSaysPaqadDisabled(root)).toBe(false);
  });
});

describe('frameworkOverridesToFlat — only non-default, only present sections', () => {
  it('emits nothing for an empty override', () => {
    expect(frameworkOverridesToFlat({}).size).toBe(0);
  });

  it('emits only values that differ from the default', () => {
    const flat = frameworkOverridesToFlat({
      enterprise: {
        enabled: true,
        evidence_ledger: false,
        ai_bom: false,
        compliance_citations: false,
      },
    } as Partial<ProjectProfile>);
    expect(flat.get('ENTERPRISE_ENABLED')).toBe('true');
    expect(flat.has('ENTERPRISE_EVIDENCE_LEDGER')).toBe(false); // equals default
  });

  it('ignores sections not present on the override', () => {
    const flat = frameworkOverridesToFlat({
      research: { depth: 'cutting-edge' },
    } as Partial<ProjectProfile>);
    expect([...flat.keys()]).toEqual(['RESEARCH_DEPTH']);
  });
});

describe('syncFrameworkConfig — authoritative, section-scoped', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes non-defaults and removes keys reset to default, within a section', () => {
    writeConfig(root, 'RAG_ENABLED=true\nRAG_TOP_N=99\n');
    // New desired intelligence state: enabled stays, top_n back to default.
    syncFrameworkConfig(root, {
      intelligence: { rag_enabled: true, rag_similarity_threshold: 0.75, rag_top_n: 20 },
    } as Partial<ProjectProfile>);
    const out = readFileSync(join(root, '.paqad', '.config'), 'utf8');
    expect(out).toMatch(/^RAG_ENABLED=true$/m);
    expect(out).not.toMatch(/^RAG_TOP_N=/m); // reset to default ⇒ removed
  });

  it('never touches sections absent from the passed profile', () => {
    writeConfig(root, 'PAQAD_ENABLED=false\nRAG_ENABLED=true\n');
    // Sync only the intelligence section; PAQAD_ENABLED must survive untouched.
    syncFrameworkConfig(root, {
      intelligence: { rag_enabled: true, rag_similarity_threshold: 0.75, rag_top_n: 20 },
    } as Partial<ProjectProfile>);
    expect(readFileSync(join(root, '.paqad', '.config'), 'utf8')).toMatch(/^PAQAD_ENABLED=false$/m);
  });
});

describe('decision sub-keys — simple knobs move, project-specific ones are preserved', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('keeps preferred_option_keys / ttl_overrides_days / max_pending in the lean YAML', () => {
    const profile = applyFrameworkConfigToProfile(
      baseProfile({
        custom: {
          classification_dimensions: [],
          verification_plugins: [],
          escalation_rules: [],
          decisions: {
            ask_threshold: 'strict',
            max_pending: 7,
            ttl_overrides_days: { 'spec.change': 5 },
          },
        },
      } as Partial<ProjectProfile>),
      DEFAULT_FRAMEWORK_CONFIG,
    );
    // Overlay: the simple knob is .config-sourced (default balanced), advanced kept.
    expect(profile.custom.decisions?.ask_threshold).toBe('balanced');
    expect(profile.custom.decisions?.max_pending).toBe(7);

    const lean = stripFrameworkConfigFromProfile(profile) as Record<string, unknown>;
    const decisions = (lean.custom as Record<string, unknown>).decisions as Record<string, unknown>;
    expect(decisions.ask_threshold).toBeUndefined(); // moved to .config
    expect(decisions.max_pending).toBe(7); // preserved in YAML
    expect(decisions.ttl_overrides_days).toEqual({ 'spec.change': 5 });
  });
});

describe('CONFIG_KEY_SECTIONS — no drift from the spec table', () => {
  it('covers every spec key exactly once', () => {
    const fromSections = CONFIG_KEY_SECTIONS.flatMap((s) => s.keys).sort();
    const fromSpecs = FRAMEWORK_CONFIG_SPECS.map((s) => s.key).sort();
    expect(fromSections).toEqual(fromSpecs);
  });
});

describe('writeConfigExample — writes the tracked template', () => {
  it('writes .paqad/.config.example matching generateConfigExample()', () => {
    const root = tmpRoot();
    try {
      const path = writeConfigExample(root);
      expect(readFileSync(path, 'utf8')).toBe(generateConfigExample());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
