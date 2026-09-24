import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/visual-evidence/provision.js', () => ({
  browserStatus: vi.fn(() => 'missing'),
}));
vi.mock('@/site-map/store.js', () => ({
  readAllJourneys: vi.fn(() => []),
}));
vi.mock('@/visual-evidence/capture-script.js', () => ({
  listCaptureScriptIds: vi.fn(() => []),
}));

import { writeProjectProfile } from '@/core/project-profile.js';
import {
  readContractDecisions,
  resolvePendingDecision,
  createPendingDecision,
} from '@/decisions/authoring.js';
import { HealthChecker } from '@/health/checker.js';
import { readAllJourneys } from '@/site-map/store.js';
import { listCaptureScriptIds } from '@/visual-evidence/capture-script.js';
import { browserStatus } from '@/visual-evidence/provision.js';
import {
  findVisualEvidenceWaiver,
  openVisualEvidenceReadinessPause,
  READINESS_DECISION_TITLE,
  readinessToken,
  visualAcRequiredFiles,
  visualEvidenceFlagOn,
  visualEvidenceReadiness,
} from '@/visual-evidence/readiness.js';

import { fixtureProfile } from '../adapters/shared.fixture.js';

// The four doctor rows, copied verbatim from HealthChecker.checkVisualEvidence before the #579
// extraction, so the byte-identical requirement (AC-19) is pinned against the old text.
const PRE_EXTRACTION_ROWS = [
  {
    name: 'Visual evidence is ready',
    status: 'warning',
    detail:
      'visual_evidence is on but site_map is off — capture scripts derive from confirmed site-map journeys, so nothing can be captured.',
    remediation:
      'Turn on site_map (env PAQAD_SITE_MAP) and author a confirmed journey + capture script.',
  },
  {
    name: 'Visual evidence is ready',
    status: 'warning',
    detail:
      'visual_evidence is on but no confirmed journey exists under docs/site-map/journeys/ — only confirmed journeys produce evidence.',
    remediation:
      'Confirm a journey (paqad-ai sitemap journey confirm) so it can back a capture script.',
  },
  {
    name: 'Visual evidence is ready',
    status: 'warning',
    detail:
      'visual_evidence is on but no *.capture.yaml exists under docs/site-map/journeys/ — there is nothing to capture.',
    remediation:
      'Author a docs/site-map/journeys/<id>.capture.yaml for a confirmed journey (see docs/modules/visual-evidence).',
  },
  {
    name: 'Visual evidence is ready',
    status: 'warning',
    detail:
      'visual_evidence is on but the capture browser is not provisioned — a capture run would record playwright-not-provisioned.',
    remediation:
      'Run `paqad-ai visual-evidence setup` to provision Playwright + Chromium under ~/.paqad-ai/ve-runtime.',
  },
];

let root: string;

function writeConfig(body: string): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', '.config'), body);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-ve-ready-'));
  vi.mocked(browserStatus).mockReturnValue('missing');
  vi.mocked(readAllJourneys).mockReturnValue([]);
  vi.mocked(listCaptureScriptIds).mockReturnValue([]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('visualEvidenceReadiness (issue #579)', () => {
  it('reports every problem in doctor order when nothing is in place', () => {
    writeConfig('visual_evidence=true\n');
    expect(visualEvidenceReadiness(root).map((p) => p.code)).toEqual([
      'site-map-off',
      'no-confirmed-journey',
      'no-capture-script',
      'browser-not-provisioned',
    ]);
  });

  it('is empty when every prerequisite is in place', () => {
    writeConfig('visual_evidence=true\nsite_map=true\n');
    vi.mocked(readAllJourneys).mockReturnValue([{ status: 'confirmed' }] as never);
    vi.mocked(listCaptureScriptIds).mockReturnValue(['checkout']);
    vi.mocked(browserStatus).mockReturnValue('provisioned');
    expect(visualEvidenceReadiness(root)).toEqual([]);
  });
});

describe('doctor visual-evidence rows after the extraction', () => {
  function visualRows(report: { checks: Array<{ name: string }> }) {
    return report.checks.filter((check) => check.name === 'Visual evidence is ready');
  }

  it('AC-19: are byte-identical to the pre-extraction rows when every check fails', async () => {
    writeConfig('visual_evidence=true\n');
    const report = await new HealthChecker().run(root);
    expect(visualRows(report)).toEqual(PRE_EXTRACTION_ROWS);
  });

  it('still reads pass when ready, and pass when the flag is off', async () => {
    writeConfig('visual_evidence=true\nsite_map=true\n');
    vi.mocked(readAllJourneys).mockReturnValue([{ status: 'confirmed' }] as never);
    vi.mocked(listCaptureScriptIds).mockReturnValue(['checkout']);
    vi.mocked(browserStatus).mockReturnValue('provisioned');
    expect(visualRows(await new HealthChecker().run(root))).toEqual([
      {
        name: 'Visual evidence is ready',
        status: 'pass',
        detail: 'Visual evidence is on and every prerequisite is in place.',
      },
    ]);

    writeConfig('visual_evidence=false\n');
    expect(visualRows(await new HealthChecker().run(root))).toEqual([
      {
        name: 'Visual evidence is ready',
        status: 'pass',
        detail: 'Visual evidence is off (default); nothing to check.',
      },
    ]);
  });
});

const DIR = '579-readiness-01JABCDEFGHJKMNPQRSTVWXYZ0';

function writeProfile(capabilities: string[]): void {
  if (!capabilities.includes('coding')) {
    // A content-only profile: no stack, so the migration cannot infer coding.
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'project-profile.yaml'),
      `project:\n  name: demo\nactive_capabilities:\n${capabilities.map((c) => `  - ${c}\n`).join('')}`,
    );
    return;
  }
  writeProjectProfile(root, {
    ...fixtureProfile('laravel'),
    active_capabilities: capabilities,
    stack_profile: {
      frameworks: ['react'],
      traits: [],
      toolchains: [],
      version_bands: [],
      sources: [],
    },
  } as never);
}

describe('openVisualEvidenceReadinessPause (issue #579, FR-9)', () => {
  it('AC-13: opens exactly one packet for a frontend change on an unready machine', () => {
    writeProfile(['coding']);
    writeConfig('visual_evidence=true\n');
    const input = { projectRoot: root, dirName: DIR, files: ['src/pages/Goals.tsx'] };

    const id = openVisualEvidenceReadinessPause(input);
    expect(id).toMatch(/^D-/);
    expect(openVisualEvidenceReadinessPause(input)).toBeNull();

    const packets = readContractDecisions(root);
    expect(packets).toHaveLength(1);
    const packet = packets[0]!.packet;
    expect(packet.category).toBe('workflow-or-tool');
    expect(packet.title).toBe(READINESS_DECISION_TITLE);
    expect(packet.context).toContain(readinessToken(DIR));
    expect(packet.context).toContain('site_map is off');
    expect(packet.options.map((o) => o.option_key)).toEqual(['setup', 'attach', 'waive']);
  });

  it('opens nothing when a resolved packet for the change already exists', () => {
    writeProfile(['coding']);
    writeConfig('visual_evidence=true\n');
    const input = { projectRoot: root, dirName: DIR, files: ['src/a.tsx'] };
    resolvePendingDecision(root, openVisualEvidenceReadinessPause(input)!, 'setup');
    expect(openVisualEvidenceReadinessPause(input)).toBeNull();
  });

  it('AC-8: opens nothing for a change with no frontend files', () => {
    writeProfile(['coding']);
    writeConfig('visual_evidence=true\n');
    expect(
      openVisualEvidenceReadinessPause({ projectRoot: root, dirName: DIR, files: ['src/a.ts'] }),
    ).toBeNull();
    expect(readContractDecisions(root)).toEqual([]);
  });

  it('opens nothing when the flag or coding is off, or the machine is ready', () => {
    const input = { projectRoot: root, dirName: DIR, files: ['src/a.tsx'] };
    writeProfile(['coding']);
    writeConfig('visual_evidence=false\n');
    expect(visualEvidenceFlagOn(root)).toBe(false);
    expect(openVisualEvidenceReadinessPause(input)).toBeNull();

    writeProfile(['content']);
    writeConfig('visual_evidence=true\n');
    expect(visualEvidenceFlagOn(root)).toBe(false);
    expect(openVisualEvidenceReadinessPause(input)).toBeNull();

    writeProfile(['coding']);
    writeConfig('visual_evidence=true\nsite_map=true\n');
    vi.mocked(readAllJourneys).mockReturnValue([{ status: 'confirmed' }] as never);
    vi.mocked(listCaptureScriptIds).mockReturnValue(['checkout']);
    vi.mocked(browserStatus).mockReturnValue('provisioned');
    expect(openVisualEvidenceReadinessPause(input)).toBeNull();
    expect(readContractDecisions(root)).toEqual([]);
  });

  it('treats a project with no profile as flag-off', () => {
    writeConfig('visual_evidence=true\n');
    expect(visualEvidenceFlagOn(root)).toBe(false);
  });
});

describe('findVisualEvidenceWaiver', () => {
  function packet(dirName: string): string {
    return createPendingDecision(root, {
      category: 'workflow-or-tool',
      title: READINESS_DECISION_TITLE,
      context: `reasons ${readinessToken(dirName)}`,
      options: [
        { option_key: 'setup', label: 'setup' },
        { option_key: 'waive', label: 'waive' },
      ],
    }).id;
  }

  it('finds only a resolved waive packet for this change', () => {
    expect(findVisualEvidenceWaiver(root, DIR)).toBeNull();
    packet(DIR); // pending: not a waiver yet
    const other = packet('other-change-01JABCDEFGHJKMNPQRSTVWXYZ1');
    resolvePendingDecision(root, other, 'waive'); // another change's waiver
    const setup = packet(DIR);
    resolvePendingDecision(root, setup, 'setup'); // resolved, but not waived
    expect(findVisualEvidenceWaiver(root, DIR)).toBeNull();

    const waived = packet(DIR);
    resolvePendingDecision(root, waived, 'waive');
    expect(findVisualEvidenceWaiver(root, DIR)).toBe(waived);
  });
});

describe('visualAcRequiredFiles (issue #579, FR-14)', () => {
  it('returns the deduped frontend files when visual evidence is on', () => {
    writeProfile(['coding']);
    writeConfig('visual_evidence=true\n');
    expect(
      visualAcRequiredFiles(root, ['src/b.tsx', 'src/a.ts', 'src/b.tsx', 'src/c.css']),
    ).toEqual(['src/b.tsx', 'src/c.css']);
  });

  it('returns nothing when visual evidence is off', () => {
    writeProfile(['coding']);
    writeConfig('visual_evidence=false\n');
    expect(visualAcRequiredFiles(root, ['src/b.tsx'])).toEqual([]);
  });
});
