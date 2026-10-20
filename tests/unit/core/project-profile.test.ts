import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import {
  getProfileDomain,
  migrateProjectProfile,
  readProjectProfile,
  syncProjectProfile,
  writeProjectProfile,
} from '@/core/project-profile.js';

describe('project profile migration', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-project-profile-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('migrates legacy coding profiles to canonical active capabilities', () => {
    const result = migrateProjectProfile({
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      routing: { domain: 'coding', stack: 'laravel', capabilities: ['boost'] },
      stack_profile: {
        domain: 'coding',
        frameworks: ['laravel'],
        traits: ['boost'],
        toolchains: [{ ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' }],
        version_bands: [],
        sources: [],
      },
      commands: baseCommands(),
      strictness: baseStrictness(),
      compliance_packs: [],
      features: baseFeatures(),
      mcp: { servers: [] },
      model_routing: baseModels(),
      research: { depth: 'standard' as const },
      efficiency: { skill_caching: true },
      escalation: baseEscalation(),
      custom: baseCustom(),
    });

    expect(result.profile.active_capabilities).toEqual(['content', 'coding', 'security']);
    expect(result.profile.stack_profile?.frameworks).toEqual(['laravel']);
    expect(result.profile.routing).toBeUndefined();
    expect(result.migrated).toBe(true);
  });

  it('migrates legacy short-video profiles to content-only canonical state', () => {
    const result = migrateProjectProfile({
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      routing: { domain: 'content', stack: 'short-video', capabilities: [] },
      stack_profile: {
        domain: 'content',
        frameworks: ['short-video'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
      commands: baseCommands(),
      strictness: baseStrictness(),
      compliance_packs: [],
      features: baseFeatures(),
      mcp: { servers: [] },
      model_routing: baseModels(),
      research: { depth: 'standard' as const },
      efficiency: { skill_caching: true },
      escalation: baseEscalation(),
      custom: baseCustom(),
    });

    expect(result.profile.active_capabilities).toEqual(['content']);
    expect(result.profile.stack_profile).toBeUndefined();
  });

  it('persists migrated profiles and records an audit log entry on read', () => {
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad/project-profile.yaml'),
      YAML.stringify({
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        routing: { domain: 'coding', stack: 'laravel', capabilities: [] },
        stack_profile: {
          domain: 'coding',
          frameworks: ['laravel'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        commands: baseCommands(),
        strictness: baseStrictness(),
        compliance_packs: [],
        features: baseFeatures(),
        mcp: { servers: [] },
        model_routing: baseModels(),
        research: { depth: 'standard' },
        efficiency: { skill_caching: true },
        escalation: baseEscalation(),
        custom: baseCustom(),
      }),
    );

    const profile = readProjectProfile(projectRoot);

    expect(profile?.active_capabilities).toEqual(['content', 'coding', 'security']);
    expect(readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8')).toContain(
      'active_capabilities:',
    );
    expect(readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8')).toContain(
      'Migrated project profile to canonical capabilities model',
    );
  });

  it('treats coding without a stack profile as a converged state, not a migration', () => {
    const canonical = migrateProjectProfile({
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content', 'coding', 'security'],
      commands: baseCommands(),
      strictness: baseStrictness(),
      compliance_packs: [],
      features: baseFeatures(),
      mcp: { servers: [] },
      model_routing: baseModels(),
      research: { depth: 'standard' as const },
      efficiency: { skill_caching: true },
      escalation: baseEscalation(),
      custom: baseCustom(),
    });

    const result = migrateProjectProfile(canonical.profile);
    expect(result.profile.active_capabilities).toEqual(['content', 'coding', 'security']);
    expect(result.profile.stack_profile).toBeUndefined();
    expect(result.migrated).toBe(false);
  });

  it('migration converges: repeated reads of a legacy profile append exactly one audit line', () => {
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    const legacyShapes: Record<string, unknown>[] = [
      { active_capabilities: ['coding'] },
      {
        active_capabilities: ['coding'],
        stack_profile: {
          frameworks: ['short-video'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      { routing: { domain: 'coding', stack: 'laravel', capabilities: [] } },
    ];

    for (const shape of legacyShapes) {
      rmSync(join(projectRoot, '.paqad/audit.log'), { force: true });
      writeFileSync(
        join(projectRoot, '.paqad/project-profile.yaml'),
        YAML.stringify({
          project: { name: 'Demo', id: 'demo', description: 'Demo' },
          commands: baseCommands(),
          strictness: baseStrictness(),
          compliance_packs: [],
          features: baseFeatures(),
          mcp: { servers: [] },
          model_routing: baseModels(),
          research: { depth: 'standard' },
          efficiency: { skill_caching: true },
          escalation: baseEscalation(),
          custom: baseCustom(),
          ...shape,
        }),
      );

      for (let read = 0; read < 3; read += 1) {
        readProjectProfile(projectRoot);
      }

      const audit = readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8');
      const migrationLines = audit
        .split('\n')
        .filter((line) => line.includes('Migrated project profile')).length;
      expect(migrationLines, `shape ${JSON.stringify(shape)}`).toBe(1);
    }
  });

  it('writes canonical profiles without routing state', () => {
    writeProjectProfile(projectRoot, {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content'],
      commands: baseCommands(),
      strictness: baseStrictness(),
      compliance_packs: [],
      features: baseFeatures(),
      mcp: { servers: [] },
      model_routing: baseModels(),
      research: { depth: 'standard' },
      efficiency: { skill_caching: true },
      escalation: baseEscalation(),
      custom: baseCustom(),
    });

    const raw = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(raw).toContain('active_capabilities:');
    expect(raw).not.toContain('\nrouting:');
    expect(getProfileDomain(readProjectProfile(projectRoot)!)).toBe('content');
  });
});

describe('project profile in-place writes', () => {
  let projectRoot: string;
  const LONG_SINGLE =
    'pnpm vitest run --reporter=json --outputFile=.paqad/test-results/vitest.json -t "<pattern>" --no-coverage';

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-project-profile-sync-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  function profilePath(): string {
    return join(projectRoot, '.paqad/project-profile.yaml');
  }

  function canonicalProfile() {
    return {
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      active_capabilities: ['content' as const],
      commands: { ...baseCommands(), test_single: LONG_SINGLE },
      compliance_packs: [],
      mcp: { servers: [] },
    };
  }

  it('writes a fresh profile with long command lines on one line', () => {
    writeProjectProfile(projectRoot, canonicalProfile());
    const raw = readFileSync(profilePath(), 'utf8');
    expect(raw).toContain(`  test_single: ${LONG_SINGLE}\n`);
  });

  it('leaves the bytes, the mtime and the audit log alone when nothing changed', () => {
    const handWritten = [
      '# project facts',
      'project:',
      '  name: Demo',
      '  id: demo',
      '  description: Demo',
      'active_capabilities: [content]',
      'commands:',
      '  install: pnpm install   # keep this',
      '  dev: pnpm dev',
      '  test: pnpm test',
      `  test_single: ${LONG_SINGLE}`,
      '  lint: pnpm lint',
      '  format: pnpm format',
      '  migrate: pnpm migrate',
      '  build: pnpm build',
      'compliance_packs: []',
      'mcp:',
      '  servers: []',
      '',
    ].join('\n');
    writeFileSync(profilePath(), handWritten);
    const past = new Date('2026-01-01T00:00:00.000Z');
    utimesSync(profilePath(), past, past);

    const result = syncProjectProfile(projectRoot, canonicalProfile(), 'no-op save');

    expect(result.written).toBe(false);
    expect(readFileSync(profilePath(), 'utf8')).toBe(handWritten);
    expect(statSync(profilePath()).mtimeMs).toBe(past.getTime());
    expect(existsSync(join(projectRoot, '.paqad/audit.log'))).toBe(false);
  });

  it('changes only the line of the key that changed and keeps comments and order', () => {
    writeProjectProfile(projectRoot, canonicalProfile());
    const withComment = readFileSync(profilePath(), 'utf8').replace(
      '  dev: pnpm dev\n',
      '  dev: pnpm dev # local server\n',
    );
    writeFileSync(profilePath(), withComment);

    const next = canonicalProfile();
    next.commands.lint = 'pnpm lint --fix';
    const result = syncProjectProfile(projectRoot, next, 'lint changed');

    expect(result.written).toBe(true);
    const before = withComment.split('\n');
    const after = readFileSync(profilePath(), 'utf8').split('\n');
    expect(after).toHaveLength(before.length);
    const changed = after.filter((line, index) => line !== before[index]);
    expect(changed).toEqual(['  lint: pnpm lint --fix']);
    expect(readFileSync(join(projectRoot, '.paqad/audit.log'), 'utf8')).toContain('lint changed');
  });

  it('adds new keys, removes dropped keys and replaces a changed list', () => {
    writeProjectProfile(projectRoot, { ...canonicalProfile(), compliance_packs: ['soc2'] });
    const next: Record<string, unknown> = { ...canonicalProfile(), compliance_packs: ['gdpr'] };
    delete next.mcp;
    next.stack_profile = undefined;
    next.testing = { runner_id: 'vitest', parallel: 'native' };
    syncProjectProfile(projectRoot, next as never);

    const onDisk = YAML.parse(readFileSync(profilePath(), 'utf8')) as Record<string, unknown>;
    expect(onDisk.compliance_packs).toEqual(['gdpr']);
    expect(onDisk.mcp).toBeUndefined();
    expect(onDisk.testing).toEqual({ runner_id: 'vitest', parallel: 'native' });
    expect(Object.keys(onDisk).at(-1)).toBe('testing');
  });

  it('rewrites a profile that cannot be parsed as a mapping', () => {
    writeFileSync(profilePath(), 'just a scalar\n');
    expect(syncProjectProfile(projectRoot, canonicalProfile()).written).toBe(true);
    writeFileSync(profilePath(), 'project: [unclosed\n');
    expect(syncProjectProfile(projectRoot, canonicalProfile()).written).toBe(true);
    const onDisk = YAML.parse(readFileSync(profilePath(), 'utf8')) as Record<string, unknown>;
    expect(onDisk.project).toEqual({ name: 'Demo', id: 'demo', description: 'Demo' });
  });
});

function baseCommands() {
  return {
    install: 'pnpm install',
    dev: 'pnpm dev',
    test: 'pnpm test',
    test_single: 'pnpm test -- one',
    lint: 'pnpm lint',
    format: 'pnpm format',
    migrate: 'pnpm migrate',
    build: 'pnpm build',
  };
}

function baseStrictness() {
  return {
    full_lane_default: false,
    require_adversarial_review: true,
    block_on_stale_docs: true,
    require_db_review_for_migrations: true,
  };
}

function baseFeatures() {
  return {
    spec_only_mode: false,
    market_research: false,
    design_research: false,
    team_agents: true,
  };
}

function baseModels() {
  return {
    default_model: 'gpt-5',
    reasoning_model: 'gpt-5',
    fast_model: 'gpt-5-mini',
  };
}

function baseEscalation() {
  return {
    destructive_operations: 'block' as const,
    risky_migrations: 'warn' as const,
    security_findings: 'block' as const,
    db_row_threshold: 10000,
  };
}

function baseCustom() {
  return {
    classification_dimensions: [],
    verification_plugins: [],
    escalation_rules: [],
  };
}
