import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import {
  CONFIG_GROUP_FILES,
  CONFIG_KEY_SECTIONS,
  DEFAULT_FRAMEWORK_CONFIG,
  FRAMEWORK_CONFIG_SPECS,
  KNOWN_CONFIG_KEYS,
  applyFrameworkConfigToProfile,
  configSaysPaqadDisabled,
  detectFlippedFrameworkValues,
  frameworkOverridesToFlat,
  generateConfigExample,
  generateConfigsReadme,
  generateGroupConfig,
  layeredConfigMap,
  listConfigsFiles,
  parseDotConfig,
  pruneUnknownKeysFromText,
  readConfigsDir,
  readDotConfig,
  reconcileConfigOverrides,
  removeConfigValue,
  resolveFrameworkConfig,
  resolveFrameworkConfigFromMap,
  setConfigValue,
  stripFrameworkConfigFromProfile,
  syncFrameworkConfig,
  syncGroupConfigs,
  writeConfigExample,
  writeConfigsReadme,
  writeFrameworkOverridesToConfig,
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

function writeConfigsFile(root: string, name: string, body: string): void {
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'configs', name), body, 'utf8');
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
    const m = parseDotConfig('rag_top_n=42\nmodel_default=gpt-x');
    expect(m.get('rag_top_n')).toBe('42');
    expect(m.get('model_default')).toBe('gpt-x');
  });

  it('ignores blank lines and full-line comments', () => {
    const m = parseDotConfig('\n# a comment\n   \n# another\npaqad_enable=false\n');
    expect(m.size).toBe(1);
    expect(m.get('paqad_enable')).toBe('false');
  });

  it('ignores lines without an = sign', () => {
    expect(parseDotConfig('this is not config').size).toBe(0);
  });

  it('tolerates an `export ` prefix', () => {
    expect(parseDotConfig('export rag_enabled=true').get('rag_enabled')).toBe('true');
  });

  it('takes quoted values verbatim (no inline-comment stripping inside quotes)', () => {
    expect(parseDotConfig('model_default="gpt-5 # turbo"').get('model_default')).toBe(
      'gpt-5 # turbo',
    );
    expect(parseDotConfig("model_fast='mini'").get('model_fast')).toBe('mini');
  });

  it('strips an inline comment from unquoted values', () => {
    expect(parseDotConfig('rag_top_n=20 # default').get('rag_top_n')).toBe('20');
  });

  it('handles CRLF line endings', () => {
    const m = parseDotConfig('a=1\r\nrag_top_n=9\r\n');
    expect(m.get('rag_top_n')).toBe('9');
  });

  it('lets the last duplicate key win', () => {
    expect(parseDotConfig('rag_top_n=1\nrag_top_n=2').get('rag_top_n')).toBe('2');
  });

  it('trims whitespace around keys and unquoted values', () => {
    expect(parseDotConfig('  rag_top_n  =  7  ').get('rag_top_n')).toBe('7');
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
        'paqad_enable=false\nrag_enabled=true\nrag_top_n=5\nresearch_depth=cutting-edge',
      ),
    );
    expect(c.paqad.enabled).toBe(false);
    expect(c.intelligence.rag_enabled).toBe(true);
    expect(c.intelligence.rag_top_n).toBe(5);
    expect(c.research.depth).toBe('cutting-edge');
  });

  it('F10: rag_base_branch is unset by default (auto-detect main->master)', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.intelligence.rag_base_branch).toBeUndefined();
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig('rag_enabled=true')).intelligence
        .rag_base_branch,
    ).toBeUndefined();
  });

  it('F10: rag_base_branch honours a configured release branch', () => {
    const c = resolveFrameworkConfigFromMap(
      parseDotConfig('rag_enabled=true\nrag_base_branch=release/2.x'),
    );
    expect(c.intelligence.rag_base_branch).toBe('release/2.x');
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'on', 'On'])('coerces %s to boolean true', (v) => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig(`rag_enabled=${v}`)).intelligence.rag_enabled,
    ).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off', 'OFF'])('coerces %s to boolean false', (v) => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig(`team_agents=${v}`)).features.team_agents,
    ).toBe(false);
  });

  it('falls back to the default for an invalid boolean', () => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig('require_adversarial_review=maybe')).strictness
        .require_adversarial_review,
    ).toBe(true);
  });

  it('falls back to the default for a non-numeric number', () => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig('rag_top_n=lots')).intelligence.rag_top_n,
    ).toBe(20);
  });

  it('falls back to the default for an out-of-enum value', () => {
    expect(
      resolveFrameworkConfigFromMap(parseDotConfig('research_depth=ludicrous')).research.depth,
    ).toBe('standard');
  });

  it('leaves the optional embedding provider/model unset by default', () => {
    expect(DEFAULT_FRAMEWORK_CONFIG.intelligence.embedding_provider).toBeUndefined();
    expect(DEFAULT_FRAMEWORK_CONFIG.intelligence.embedding_model).toBeUndefined();
  });

  it('honors an explicit embedding provider', () => {
    const c = resolveFrameworkConfigFromMap(
      parseDotConfig('rag_enabled=true\nrag_embedding_provider=openai'),
    );
    expect(c.intelligence.embedding_provider).toBe('openai');
  });

  it('still fills framework-internal RAG tuning (bucket C) from code defaults', () => {
    const c = DEFAULT_FRAMEWORK_CONFIG;
    expect(c.intelligence.benchmark_gates?.hit_at_5_improvement_pct).toBe(20);
    expect(c.intelligence.adaptive_retrieval?.enabled).toBe(true);
  });
});

describe('layeredConfigMap — four surfaces, LOCAL WINS', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reads team configs/.config.* as the base layer', () => {
    writeConfigsFile(root, '.config.app', 'enterprise=true\n');
    expect(layeredConfigMap(root, {}).get('enterprise')).toBe('true');
  });

  it('lets local .config override the team configs/ layer (LOCAL WINS)', () => {
    writeConfigsFile(root, '.config.app', 'rag_top_n=5\n');
    writeConfig(root, 'rag_top_n=9\n');
    expect(layeredConfigMap(root, {}).get('rag_top_n')).toBe('9');
  });

  it('lets a PAQAD_* env var override both files (escape hatch)', () => {
    writeConfigsFile(root, '.config.app', 'rag_top_n=5\n');
    writeConfig(root, 'rag_top_n=9\n');
    expect(layeredConfigMap(root, { PAQAD_RAG_TOP_N: '1' }).get('rag_top_n')).toBe('1');
  });

  it('ignores an empty env var (does not shadow a real file value)', () => {
    writeConfig(root, 'rag_top_n=9\n');
    expect(layeredConfigMap(root, { PAQAD_RAG_TOP_N: '   ' }).get('rag_top_n')).toBe('9');
  });

  it('a present configs file picks up framework defaults for empty or absent keys', () => {
    // The mere existence of a configs file forces nothing: a key set to an empty
    // value, and a key not present at all, both resolve to the code default. Only
    // an explicit, non-empty, recognised value overrides.
    writeConfigsFile(root, '.config.app', 'enterprise=true\nrag_top_n=\nmodel_default=\n');
    const c = resolveFrameworkConfig(root, {});
    expect(c.enterprise.enabled).toBe(true); // the one explicit value overrides
    expect(c.intelligence.rag_top_n).toBe(20); // empty value -> default
    expect(c.model_routing.default_model).toBe('gpt-5'); // empty value -> default
    expect(c.research.depth).toBe('standard'); // absent key -> default
  });

  it('resolveFrameworkConfig threads env through the full precedence', () => {
    writeConfigsFile(root, '.config.policy', 'research_depth=conservative\n');
    expect(resolveFrameworkConfig(root, {}).research.depth).toBe('conservative');
    expect(
      resolveFrameworkConfig(root, { PAQAD_RESEARCH_DEPTH: 'cutting-edge' }).research.depth,
    ).toBe('cutting-edge');
  });
});

describe('readConfigsDir — merge + collisions', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns an empty map + no collisions when configs/ is absent', () => {
    const { merged, collisions } = readConfigsDir(root);
    expect(merged.size).toBe(0);
    expect(collisions).toEqual([]);
    expect(listConfigsFiles(root)).toEqual([]);
  });

  it('merges multiple files; later filename wins on a collision and reports it', () => {
    writeConfigsFile(root, '.config.app', 'rag_top_n=5\nenterprise=true\n');
    writeConfigsFile(root, '.config.rag', 'rag_top_n=9\n'); // collision on rag_top_n
    const { merged, collisions } = readConfigsDir(root);
    expect(merged.get('rag_top_n')).toBe('9'); // .config.rag sorts after .config.app
    expect(merged.get('enterprise')).toBe('true');
    expect(collisions).toEqual([{ key: 'rag_top_n', files: expect.any(Array) }]);
    expect(collisions[0].files).toHaveLength(2);
  });

  it('never sweeps in the .config.example catalog', () => {
    writeConfigsFile(root, '.config.app', 'enterprise=true\n');
    // A stray example inside configs/ must be ignored by the glob.
    writeConfigsFile(root, '.config.example', 'enterprise=false\n');
    expect(readConfigsDir(root).merged.get('enterprise')).toBe('true');
  });
});

describe('applyFrameworkConfigToProfile — overlay + hard cutover', () => {
  it('overlays every framework section onto a lean base profile', () => {
    const profile = applyFrameworkConfigToProfile(
      baseProfile(),
      resolveFrameworkConfigFromMap(parseDotConfig('rag_enabled=true\nenterprise=true')),
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

describe('readDotConfig / resolveFrameworkConfig', () => {
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
      writeConfig(root, 'rag_top_n=3\n');
      expect(resolveFrameworkConfig(root).intelligence.rag_top_n).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('generateGroupConfig — self-documenting group files, defaults by default', () => {
  const GROUPS = Object.keys(CONFIG_GROUP_FILES) as Array<keyof typeof CONFIG_GROUP_FILES>;

  it('each group file has an intro header and documents its keys, all commented out', () => {
    for (const group of GROUPS) {
      const text = generateGroupConfig(group);
      expect(text).toMatch(/^# \.paqad\/configs\/\.config\./m); // intro header line
      for (const spec of FRAMEWORK_CONFIG_SPECS.filter((s) => s.group === group)) {
        expect(text).toContain(spec.env); // env equivalent documented
        expect(text).toMatch(new RegExp(`^# ${spec.key}=`, 'm')); // present, commented out
        expect(text).not.toMatch(new RegExp(`^${spec.key}=`, 'm')); // not active by default
      }
    }
  });

  it('the four group files together cover every knob exactly once', () => {
    const inFiles = GROUPS.flatMap((g) =>
      FRAMEWORK_CONFIG_SPECS.filter((s) => s.group === g).map((s) => s.key),
    ).sort();
    expect(inFiles).toEqual(FRAMEWORK_CONFIG_SPECS.map((s) => s.key).sort());
  });

  it('is byte-stable across re-runs (idempotent onboarding)', () => {
    for (const group of GROUPS) {
      expect(generateGroupConfig(group)).toBe(generateGroupConfig(group));
    }
  });

  it('round-trips: uncommenting every knob line resolves back to the code defaults', () => {
    const uncommented = GROUPS.map((g) => generateGroupConfig(g))
      .join('\n')
      .replace(/^# ([a-z0-9_]+=.*)$/gm, '$1'); // activate the "# key=default" lines
    expect(resolveFrameworkConfigFromMap(parseDotConfig(uncommented))).toEqual(
      DEFAULT_FRAMEWORK_CONFIG,
    );
  });

  it('re-emits an already-active override instead of commenting it', () => {
    const text = generateGroupConfig('app', new Map([['enterprise', 'true']]));
    expect(text).toMatch(/^enterprise=true$/m); // active
    expect(text).not.toMatch(/^# enterprise=/m); // not the commented default
  });
});

describe('generateConfigExample — the single copy-paste catalog', () => {
  const example = generateConfigExample();

  it('documents every knob and its env equivalent, all commented out', () => {
    for (const spec of FRAMEWORK_CONFIG_SPECS) {
      expect(example).toContain(spec.env);
      expect(example).toMatch(new RegExp(`^# ${spec.key}=`, 'm')); // present, commented
      expect(example).not.toMatch(new RegExp(`^${spec.key}=`, 'm')); // never active
    }
  });

  it('is byte-stable across re-runs (idempotent onboarding/update)', () => {
    expect(generateConfigExample()).toBe(example);
  });

  it('round-trips: uncommenting every knob line resolves back to the code defaults', () => {
    const uncommented = example.replace(/^# ([a-z0-9_]+=.*)$/gm, '$1');
    expect(resolveFrameworkConfigFromMap(parseDotConfig(uncommented))).toEqual(
      DEFAULT_FRAMEWORK_CONFIG,
    );
  });

  it('writeConfigExample writes .paqad/.config.example matching the generator', () => {
    const root = tmpRoot();
    try {
      const path = writeConfigExample(root);
      expect(existsSync(path)).toBe(true);
      expect(readFileSync(path, 'utf8')).toBe(generateConfigExample());
      // It is never read, so it never changes resolution.
      expect(resolveFrameworkConfig(root, {})).toEqual(DEFAULT_FRAMEWORK_CONFIG);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('generateConfigsReadme — the team-override convention', () => {
  const readme = generateConfigsReadme();
  it('names each suggested group file', () => {
    for (const file of Object.values(CONFIG_GROUP_FILES)) {
      expect(readme).toContain(file);
    }
  });
  it('states the never-reset / prune-only contract', () => {
    expect(readme.toLowerCase()).toContain('prune');
    expect(readme).toContain('never');
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
    writeConfig(root, 'rag_enabled=true\nenterprise=true\n');
    const profile = readProjectProfile(root)!;
    expect(profile.intelligence.rag_enabled).toBe(true);
    expect(profile.enterprise?.enabled).toBe(true);
  });

  it('a team configs/ override is reflected in the in-memory profile', () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'project-profile.yaml'),
      YAML.stringify(baseProfile()),
      'utf8',
    );
    writeConfigsFile(root, '.config.app', 'enterprise=true\n');
    expect(readProjectProfile(root)!.enterprise?.enabled).toBe(true);
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
    setConfigValue(root, 'paqad_enable', 'false');
    expect(readFileSync(configPath(), 'utf8')).toMatch(/^paqad_enable=false$/m);
  });

  it('replaces an existing assignment, preserving other lines and comments', () => {
    writeConfig(root, '# header\nrag_top_n=20\nmodel_default=gpt-5\n');
    setConfigValue(root, 'rag_top_n', '99');
    const out = readFileSync(configPath(), 'utf8');
    expect(out).toMatch(/^rag_top_n=99$/m);
    expect(out).toContain('# header');
    expect(out).toMatch(/^model_default=gpt-5$/m);
    expect(out).not.toContain('rag_top_n=20');
  });

  it('does not overwrite a commented-out key (appends instead)', () => {
    writeConfig(root, '# rag_top_n=20\n');
    setConfigValue(root, 'rag_top_n', '5');
    const out = readFileSync(configPath(), 'utf8');
    expect(out).toContain('# rag_top_n=20');
    expect(out).toMatch(/^rag_top_n=5$/m);
  });

  it('removeConfigValue deletes the key but keeps comments and other keys', () => {
    writeConfig(root, '# keep\nrag_top_n=5\nmodel_fast=mini\n');
    removeConfigValue(root, 'rag_top_n');
    const out = readFileSync(configPath(), 'utf8');
    expect(out).not.toMatch(/^rag_top_n=/m);
    expect(out).toContain('# keep');
    expect(out).toMatch(/^model_fast=mini$/m);
  });

  it('removeConfigValue is a no-op when .config is absent', () => {
    expect(() => removeConfigValue(root, 'rag_top_n')).not.toThrow();
  });

  it('configSaysPaqadDisabled tracks the layered off-signal', () => {
    expect(configSaysPaqadDisabled(root)).toBe(false); // absent
    setConfigValue(root, 'paqad_enable', 'false');
    expect(configSaysPaqadDisabled(root)).toBe(true);
    setConfigValue(root, 'paqad_enable', 'true');
    expect(configSaysPaqadDisabled(root)).toBe(false);
    setConfigValue(root, 'paqad_enable', 'banana'); // unrecognised ⇒ not disabled
    expect(configSaysPaqadDisabled(root)).toBe(false);
  });

  it('configSaysPaqadDisabled honors the PAQAD_ENABLE env escape hatch', () => {
    setConfigValue(root, 'paqad_enable', 'true');
    expect(configSaysPaqadDisabled(root, { PAQAD_ENABLE: 'false' })).toBe(true); // env wins
  });

  it('configSaysPaqadDisabled reads a team configs/ off-signal', () => {
    writeConfigsFile(root, '.config.app', 'paqad_enable=false\n');
    expect(configSaysPaqadDisabled(root, {})).toBe(true);
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
    expect(flat.get('enterprise')).toBe('true');
    expect(flat.has('enterprise_evidence_ledger')).toBe(false); // equals default
  });

  it('ignores sections not present on the override', () => {
    const flat = frameworkOverridesToFlat({
      research: { depth: 'cutting-edge' },
    } as Partial<ProjectProfile>);
    expect([...flat.keys()]).toEqual(['research_depth']);
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
    writeConfig(root, 'rag_enabled=true\nrag_top_n=99\n');
    syncFrameworkConfig(root, {
      intelligence: { rag_enabled: true, rag_similarity_threshold: 0.75, rag_top_n: 20 },
    } as Partial<ProjectProfile>);
    const out = readFileSync(join(root, '.paqad', '.config'), 'utf8');
    expect(out).toMatch(/^rag_enabled=true$/m);
    expect(out).not.toMatch(/^rag_top_n=/m); // reset to default ⇒ removed
  });

  it('never touches sections absent from the passed profile', () => {
    writeConfig(root, 'paqad_enable=false\nrag_enabled=true\n');
    syncFrameworkConfig(root, {
      intelligence: { rag_enabled: true, rag_similarity_threshold: 0.75, rag_top_n: 20 },
    } as Partial<ProjectProfile>);
    expect(readFileSync(join(root, '.paqad', '.config'), 'utf8')).toMatch(/^paqad_enable=false$/m);
  });
});

describe('reconcileConfigOverrides — prune obsolete keys, never reset', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('pruneUnknownKeysFromText drops only unknown assignments, preserving the rest', () => {
    const text = '# header\nenterprise=true\nlegacy_knob=on\n\nrag_top_n=9\n';
    const { text: out, removed } = pruneUnknownKeysFromText(text);
    expect(removed).toEqual(['legacy_knob']);
    expect(out).toContain('# header'); // comment preserved
    expect(out).toContain('enterprise=true'); // value preserved verbatim
    expect(out).toContain('rag_top_n=9');
    expect(out).not.toContain('legacy_knob');
  });

  it('returns byte-identical text when every key is known', () => {
    const text = '# x\nenterprise=true\nrag_top_n=9\n';
    expect(pruneUnknownKeysFromText(text).text).toBe(text);
  });

  it('prunes obsolete keys from .config and configs/ but keeps valid values', () => {
    writeConfig(root, 'enterprise=true\nremoved_in_2_0=yes\n');
    writeConfigsFile(root, '.config.app', 'rag_top_n=9\nold_team_knob=1\n');
    const report = reconcileConfigOverrides(root);
    const pruned = report.flatMap((r) => r.removed).sort();
    expect(pruned).toEqual(['old_team_knob', 'removed_in_2_0']);
    // Valid values survive untouched (never reset to default).
    expect(readFileSync(join(root, '.paqad', '.config'), 'utf8')).toContain('enterprise=true');
    expect(readFileSync(join(root, '.paqad', 'configs', '.config.app'), 'utf8')).toContain(
      'rag_top_n=9',
    );
  });

  it('is a no-op (no report) when nothing is obsolete', () => {
    writeConfig(root, 'enterprise=true\n');
    expect(reconcileConfigOverrides(root)).toEqual([]);
  });
});

describe('detectFlippedFrameworkValues — the no-migration safety net', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('returns [] for an absent or already-lean profile', () => {
    expect(detectFlippedFrameworkValues(root)).toEqual([]);
    writeFileSync(
      join(root, '.paqad', 'project-profile.yaml'),
      YAML.stringify(baseProfile()),
      'utf8',
    );
    expect(detectFlippedFrameworkValues(root)).toEqual([]);
  });

  it('reports non-default framework values a legacy fat profile still carries', () => {
    const fat = {
      ...baseProfile(),
      enterprise: {
        enabled: true,
        evidence_ledger: false,
        ai_bom: false,
        compliance_citations: false,
      },
      research: { depth: 'cutting-edge' },
    };
    writeFileSync(join(root, '.paqad', 'project-profile.yaml'), YAML.stringify(fat), 'utf8');
    expect(detectFlippedFrameworkValues(root).sort()).toEqual([
      'enterprise=true',
      'research_depth=cutting-edge',
    ]);
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
    expect(profile.custom.decisions?.ask_threshold).toBe('balanced');
    expect(profile.custom.decisions?.max_pending).toBe(7);

    const lean = stripFrameworkConfigFromProfile(profile) as Record<string, unknown>;
    const decisions = (lean.custom as Record<string, unknown>).decisions as Record<string, unknown>;
    expect(decisions.ask_threshold).toBeUndefined(); // moved to the config layer
    expect(decisions.max_pending).toBe(7); // preserved in YAML
    expect(decisions.ttl_overrides_days).toEqual({ 'spec.change': 5 });
  });
});

describe('the knob registry — internally consistent, no drift', () => {
  it('CONFIG_KEY_SECTIONS covers every spec key exactly once', () => {
    const fromSections = CONFIG_KEY_SECTIONS.flatMap((s) => s.keys).sort();
    const fromSpecs = FRAMEWORK_CONFIG_SPECS.map((s) => s.key).sort();
    expect(fromSections).toEqual(fromSpecs);
  });

  it('every key is bare/lowercase and every env is a unique PAQAD_* name', () => {
    const envs = new Set<string>();
    const keys = new Set<string>();
    for (const spec of FRAMEWORK_CONFIG_SPECS) {
      expect(spec.key).toMatch(/^[a-z0-9_]+$/);
      expect(spec.env).toMatch(/^PAQAD_[A-Z0-9_]+$/);
      expect(envs.has(spec.env)).toBe(false);
      expect(keys.has(spec.key)).toBe(false);
      envs.add(spec.env);
      keys.add(spec.key);
    }
  });

  it('KNOWN_CONFIG_KEYS equals the spec key set', () => {
    expect([...KNOWN_CONFIG_KEYS].sort()).toEqual(FRAMEWORK_CONFIG_SPECS.map((s) => s.key).sort());
  });
});

describe('syncGroupConfigs / writeConfigsReadme — the tracked team files', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('onboard writes one commented file per group; everything still resolves to defaults', () => {
    const written = syncGroupConfigs(root);
    expect(written).toHaveLength(4);
    for (const file of Object.values(CONFIG_GROUP_FILES)) {
      expect(existsSync(join(root, '.paqad', 'configs', file))).toBe(true);
    }
    // All keys are commented out, so the resolved config equals the code defaults.
    expect(resolveFrameworkConfig(root, {})).toEqual(DEFAULT_FRAMEWORK_CONFIG);
  });

  it('is idempotent: a second sync changes nothing', () => {
    syncGroupConfigs(root);
    expect(syncGroupConfigs(root)).toEqual([]);
  });

  it('appends a newly-introduced key (commented) to an existing file, preserving edits', () => {
    // An older/hand-edited file: a custom comment + an active override, missing
    // most of the app-group keys.
    writeConfigsFile(root, '.config.app', '# our team header\nenterprise=true\n');
    syncGroupConfigs(root);
    const app = readFileSync(join(root, '.paqad', 'configs', '.config.app'), 'utf8');
    expect(app).toContain('# our team header'); // custom comment preserved
    expect(app).toContain('enterprise=true'); // active override preserved (not reset)
    expect(app).toMatch(/^# auto_update=true$/m); // a missing app-group key appended, commented
  });

  it('writes .paqad/configs/README.md matching generateConfigsReadme()', () => {
    const path = writeConfigsReadme(root);
    expect(readFileSync(path, 'utf8')).toBe(generateConfigsReadme());
  });
});

describe('edge paths — graceful handling of malformed input', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('parseDotConfig ignores an assignment with an empty key', () => {
    const m = parseDotConfig('=novalue\nrag_top_n=3');
    expect(m.size).toBe(1);
    expect(m.get('rag_top_n')).toBe('3');
  });

  it('readConfigsDir skips a configs entry it cannot read (e.g. a directory)', () => {
    // A directory named like a config file matches the glob; reading it throws
    // and must be skipped, not crash, while sibling files still resolve.
    mkdirSync(join(root, '.paqad', 'configs', '.config.dir'), { recursive: true });
    writeConfigsFile(root, '.config.app', 'enterprise=true\n');
    const { merged } = readConfigsDir(root);
    expect(merged.get('enterprise')).toBe('true');
  });

  it('an out-of-enum optional embedding provider resolves to undefined', () => {
    const c = resolveFrameworkConfigFromMap(parseDotConfig('rag_embedding_provider=bogus'));
    expect(c.intelligence.embedding_provider).toBeUndefined();
  });

  it('pruneUnknownKeysFromText preserves a non-assignment, non-comment line', () => {
    const text = 'enterprise=true\nthis line has no equals sign\nrag_top_n=9\n';
    const { text: out, removed } = pruneUnknownKeysFromText(text);
    expect(removed).toEqual([]); // nothing pruned (the prose line is not an assignment)
    expect(out).toBe(text); // byte-identical
  });

  it('detectFlippedFrameworkValues returns [] for malformed or non-object YAML', () => {
    const p = join(root, '.paqad', 'project-profile.yaml');
    writeFileSync(p, ':\n: : not valid yaml ][', 'utf8');
    expect(detectFlippedFrameworkValues(root)).toEqual([]);
    writeFileSync(p, 'just a scalar string', 'utf8'); // parses to a non-object
    expect(detectFlippedFrameworkValues(root)).toEqual([]);
  });

  it('writeFrameworkOverridesToConfig writes only the non-default keys it was given', () => {
    const written = writeFrameworkOverridesToConfig(root, {
      enterprise: {
        enabled: true,
        evidence_ledger: false,
        ai_bom: false,
        compliance_citations: false,
      },
    } as Partial<ProjectProfile>);
    expect(written).toEqual(['enterprise']);
    expect(readFileSync(join(root, '.paqad', '.config'), 'utf8')).toMatch(/^enterprise=true$/m);
  });
});
