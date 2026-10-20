import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import type { AppMap } from '@/core/types/site-map.js';
import type { SiteMapFinding } from '@/core/types/site-map-run.js';
import { readBaseline } from '@/site-map/baseline.js';
import {
  blockedExtractor,
  type ExtractedSurface,
  type ExtractionResult,
  type ExtractorOutput,
} from '@/site-map/extraction.js';
import { SITE_MAP_RUN_DOC_TYPE } from '@/site-map/ledger.js';
import {
  deriveSiteMapInventory,
  deriveSiteMapVerdict,
  describeSiteMapInventory,
  gatherSiteMapReport,
  runSiteMapAudit,
  type SiteMapGatherer,
} from '@/site-map/run.js';
import { readCanonicalSiteMap, writeCanonicalSiteMap } from '@/site-map/store.js';
import { readAllSessionRows } from '@/session-ledger/ledger.js';

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-sitemap-run-'));
}

function surface(overrides: Partial<ExtractedSurface> = {}): ExtractedSurface {
  return {
    raw_id: 'node-cli-sitemap',
    kind: 'cli-command',
    label: 'Site map',
    evidence: [{ file: 'src/cli/sitemap.ts', line: 12 }],
    derivation: 'static',
    confidence: 'high',
    source: 'node-cli',
    ...overrides,
  };
}

const coveringMap: AppMap = {
  schema_version: 1,
  app: { name: 'paqad-ai', kind: 'cli' },
  surfaces: [
    {
      id: 's',
      kind: 'cli-command',
      label: 'Site map',
      evidence: [{ file: 'src/cli/sitemap.ts', line: 12 }],
    },
  ],
};

const canonicalMap: AppMap = {
  schema_version: 1,
  app: { name: 'paqad-ai', kind: 'cli' },
  surfaces: [
    {
      id: 's-home',
      kind: 'page',
      label: 'Home',
      evidence: [{ file: 'src/app.ts', line: 1 }],
    },
  ],
};

const navigableMap: AppMap = {
  schema_version: 1,
  app: { name: 'paqad-ai', kind: 'cli' },
  surfaces: [
    {
      id: 's-a',
      kind: 'page',
      label: 'A',
      entry: { kind: 'url', value: '/' },
      transitions: [{ to: 's-b', trigger: 'go' }],
    },
    { id: 's-b', kind: 'page', label: 'B', ends: { success: true } },
  ],
};

function gatherer(overrides: Partial<SiteMapGatherer> = {}): SiteMapGatherer {
  return {
    appKind: () => 'cli',
    appSummary: () => ({ name: 'paqad-ai', kind: 'cli', frameworks: ['commander'] }),
    loadAppMap: () => null,
    journeyCount: () => 0,
    resolveEvidence: (pointers) =>
      pointers.map((pointer) => ({ file: pointer.file, line: pointer.line, status: 'resolved' })),
    extractors: async (): Promise<ExtractorOutput[]> => [
      { extractor: 'node-cli', available: true, surfaces: [surface()] },
    ],
    gatherTransitions: () => [],
    ...overrides,
  };
}

function readFindingIndex(
  root: string,
  bundleDir: string,
): { report_id: string; findings: SiteMapFinding[] } {
  return JSON.parse(readFileSync(join(root, bundleDir, 'finding-index.json'), 'utf8')) as {
    report_id: string;
    findings: SiteMapFinding[];
  };
}

describe('runSiteMapAudit', () => {
  it('runs offline through a fake gatherer, persists the evidence bundle, and creates the baseline (AC-4)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-run',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });

    expect(result.report_id).toBe('SITEMAP-2026-01-02-03-04-05');
    expect(result.exit_code).toBe(1);
    expect(result.finding_count).toBe(1);
    expect(result.baseline_created).toBe(true);
    expect(result.blocked_checks.map((check) => check.check)).toEqual(['map-present']);
    expect(result.verdict).toBe('attention');

    const findingIndex = readFindingIndex(root, result.bundle_dir);
    expect(findingIndex.report_id).toBe(result.report_id);
    expect(findingIndex.findings).toHaveLength(1);
    const extraction = JSON.parse(
      readFileSync(join(root, result.bundle_dir, 'extraction.json'), 'utf8'),
    );
    expect(extraction.surfaces).toHaveLength(1);

    expect(existsSync(join(root, 'docs'))).toBe(false);

    expect(readBaseline(root)).not.toBeNull();
  });

  it('writes a single site-map-run ledger row so the run flows into audit export (AC-6)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-ledger',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    const rows = readAllSessionRows(root, SITE_MAP_RUN_DOC_TYPE);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.report_id).toBe(result.report_id);
    expect(rows[0]!.event_status).toBe('findings');
  });

  it('exits clean over a covering map and records app-map + journeys as sources (AC-8)', async () => {
    const root = repo();
    const covering = gatherer({ loadAppMap: () => coveringMap, journeyCount: () => 2 });
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: covering,
      sessionId: 's-clean',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.exit_code).toBe(0);
    expect(result.finding_count).toBe(0);
    expect(existsSync(join(root, 'docs'))).toBe(false);

    const { report } = await gatherSiteMapReport({
      projectRoot: root,
      gatherer: covering,
      workflow: 'site-map',
      now: new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(report.surface_count).toBe(1);
    expect(report.journey_count).toBe(2);
    expect(report.sources_used).toEqual(['app-map.yaml', 'journeys', 'node-cli']);
    expect(readAllSessionRows(root, SITE_MAP_RUN_DOC_TYPE)[0]!.event_status).toBe('clean');
  });

  it('reuses an existing baseline on a later run and marks the finding pre-existing', async () => {
    const root = repo();
    await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-1',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    const second = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-2',
      now: () => new Date(2026, 0, 3, 3, 4, 5),
    });
    expect(second.baseline_created).toBe(false);
    const { report } = await gatherSiteMapReport({
      projectRoot: root,
      gatherer: gatherer(),
      workflow: 'site-map',
      now: new Date(2026, 0, 4, 3, 4, 5),
    });
    expect(report.baseline.existed).toBe(true);
    expect(report.baseline.pre_existing).toBe(1);
    expect(report.baseline.new_since_baseline).toBe(0);
  });

  it('defaults the clock and the workflow name', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-defaults',
    });
    expect(result.report_id).toMatch(/^SITEMAP-\d{4}-/);
    expect(readAllSessionRows(root, SITE_MAP_RUN_DOC_TYPE)[0]!.workflow).toBe('site-map');
  });

  it('resolves cited evidence through the gatherer and records Tier-A findings (AC-7)', async () => {
    const root = repo();
    const map: AppMap = {
      schema_version: 1,
      app: { name: 'paqad-ai', kind: 'cli' },
      guards: [{ id: 'g-admin', kind: 'role', label: 'Admin' }],
      surfaces: [
        {
          id: 's-home',
          kind: 'page',
          label: 'Home',
          entry: { kind: 'url', value: '/' },
          evidence: [{ file: 'src/gone.ts', line: 3 }],
          transitions: [{ to: 's-missing', trigger: 'click' }],
        },
      ],
    };
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({
        loadAppMap: () => map,
        extractors: async () => [],
        resolveEvidence: (pointers) =>
          pointers.map((pointer) => ({
            file: pointer.file,
            line: pointer.line,
            status: 'file-missing',
          })),
      }),
      sessionId: 's-tier-a',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.exit_code).toBe(1);
    const { findings } = readFindingIndex(root, result.bundle_dir);
    const categories = findings.map((finding) => finding.category).sort();
    expect(categories).toContain('SM-REMOVE');
    expect(categories).toContain('SM-XREF');
  });

  it('surfaces an ungrounded graph (transitions but no entry) as a blocked reachability check', async () => {
    const root = repo();
    const map: AppMap = {
      schema_version: 1,
      app: { name: 'paqad-ai', kind: 'cli' },
      surfaces: [
        { id: 's-a', kind: 'page', label: 'A', transitions: [{ to: 's-b', trigger: 'go' }] },
        { id: 's-b', kind: 'page', label: 'B', ends: { success: true } },
      ],
    };
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({ loadAppMap: () => map, extractors: async () => [] }),
      sessionId: 's-blocked-graph',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.blocked_checks.map((check) => check.check)).toContain('reachability');
  });

  it('records a blocked extractor as a gap and still completes the run (FR-3)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({
        extractors: async () => [blockedExtractor('rails-routes', 'ruby missing', 'Install Ruby')],
      }),
      sessionId: 's-blocked',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.exit_code).toBe(0);
    const checkNames = result.blocked_checks.map((check) => check.check);
    expect(checkNames).toContain('rails-routes surface extraction');
    expect(checkNames).toContain('map-present');
    expect(result.verdict).toBe('inconclusive');
    const extraction = JSON.parse(
      readFileSync(join(root, result.bundle_dir, 'extraction.json'), 'utf8'),
    ) as { low_confidence_fallback: boolean };
    expect(extraction.low_confidence_fallback).toBe(true);
  });

  it('reports no-map and writes nothing when no canonical map is authored yet (C8)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer(),
      sessionId: 's-no-canonical',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.trust_restamp.status).toBe('no-map');
    expect(existsSync(join(root, PATHS.SITE_MAP_CANONICAL_APP_MAP))).toBe(false);
  });

  it('stamps earned trust + freshness into the canonical map from the resolved evidence (C8)', async () => {
    const root = repo();
    writeCanonicalSiteMap(root, canonicalMap);
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({ loadAppMap: () => null }),
      sessionId: 's-stamp',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.trust_restamp.status).toBe('stamped');
    if (result.trust_restamp.status === 'stamped') {
      expect(result.trust_restamp.path).toBe(join(root, PATHS.SITE_MAP_CANONICAL_APP_MAP));
    }
    const stamped = readCanonicalSiteMap(root);
    expect(stamped?.surfaces[0]!.trust).toBe('proven-in-code');
    expect(stamped?.app.freshness).toEqual({
      anchors_total: 1,
      anchors_resolved: 1,
      anchors_broken: 0,
    });
  });

  it('reports unchanged on a second run over a steady canonical map and steady code (C8)', async () => {
    const root = repo();
    writeCanonicalSiteMap(root, canonicalMap);
    await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({ loadAppMap: () => null }),
      sessionId: 's-stamp-1',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    const second = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({ loadAppMap: () => null }),
      sessionId: 's-stamp-2',
      now: () => new Date(2026, 0, 3, 3, 4, 5),
    });
    expect(second.trust_restamp.status).toBe('unchanged');
  });

  describe('verdict (S2, D4)', () => {
    it('an absent map with no extracted surfaces is inconclusive with a map-present block, exit 0', async () => {
      const root = repo();
      const result = await runSiteMapAudit({
        projectRoot: root,
        gatherer: gatherer({ loadAppMap: () => null, extractors: async () => [] }),
        sessionId: 's-verdict-nomap',
        now: () => new Date(2026, 0, 2, 3, 4, 5),
      });
      expect(result.finding_count).toBe(0);
      expect(result.blocked_checks.map((check) => check.check)).toEqual(['map-present']);
      expect(result.verdict).toBe('inconclusive');
      expect(result.exit_code).toBe(0);
    });

    it('a map with surfaces but zero transitions is inconclusive with a reachability block, exit 0', async () => {
      const root = repo();
      const result = await runSiteMapAudit({
        projectRoot: root,
        gatherer: gatherer({ loadAppMap: () => coveringMap }),
        sessionId: 's-verdict-notransitions',
        now: () => new Date(2026, 0, 2, 3, 4, 5),
      });
      expect(result.finding_count).toBe(0);
      expect(result.blocked_checks.map((check) => check.check)).toEqual(['reachability']);
      expect(result.verdict).toBe('inconclusive');
      expect(result.exit_code).toBe(0);
    });

    it('a navigable map with no findings and no blocked checks is safe, exit 0', async () => {
      const root = repo();
      const result = await runSiteMapAudit({
        projectRoot: root,
        gatherer: gatherer({ loadAppMap: () => navigableMap, extractors: async () => [] }),
        sessionId: 's-verdict-safe',
        now: () => new Date(2026, 0, 2, 3, 4, 5),
      });
      expect(result.finding_count).toBe(0);
      expect(result.blocked_checks).toEqual([]);
      expect(result.verdict).toBe('safe');
      expect(result.exit_code).toBe(0);
    });

    it('findings alongside a blocked check read as attention, exit 1', async () => {
      const root = repo();
      const result = await runSiteMapAudit({
        projectRoot: root,
        gatherer: gatherer({
          loadAppMap: () => coveringMap,
          extractors: async () => [
            {
              extractor: 'node-cli',
              available: true,
              surfaces: [
                surface({ raw_id: 'unmapped', evidence: [{ file: 'src/other.ts', line: 1 }] }),
              ],
            },
          ],
        }),
        sessionId: 's-verdict-attention',
        now: () => new Date(2026, 0, 2, 3, 4, 5),
      });
      expect(result.finding_count).toBe(1);
      expect(result.blocked_checks.map((check) => check.check)).toEqual(['reachability']);
      expect(result.verdict).toBe('attention');
      expect(result.exit_code).toBe(1);
    });
  });
});

describe('runSiteMapAudit — reconcile missing links (S9c)', () => {
  const linkMap: AppMap = {
    schema_version: 1,
    app: { name: 'paqad-ai', kind: 'cli' },
    surfaces: [
      { id: 's-a', kind: 'page', label: 'A' },
      { id: 's-b', kind: 'page', label: 'B', entry: { kind: 'url', value: '/b' } },
      { id: 's-c', kind: 'page', label: 'C', entry: { kind: 'url', value: '/c' } },
    ],
  };
  const edgeToB: ExtractedTransition = {
    from_raw_id: 's-a',
    to_target: '/b',
    trigger: 'navigate',
    evidence: [{ file: 'src/a.ts', line: 5 }],
    confidence: 'high',
  };

  it('raises SM-EDGE-MISSING for a code-proven edge the map does not record (AC-1)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({
        loadAppMap: () => linkMap,
        extractors: async () => [],
        gatherTransitions: () => [edgeToB],
      }),
      sessionId: 's-edge',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    const findingIndex = readFindingIndex(root, result.bundle_dir);
    expect(findingIndex.findings.map((f) => f.category)).toContain('SM-EDGE-MISSING');
  });

  it('reports transition_count from the transitions the stored map records (AC-6)', async () => {
    const root = repo();
    const withLinks = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({ loadAppMap: () => navigableMap, extractors: async () => [] }),
      sessionId: 's-count-1',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(withLinks.transition_count).toBe(1);

    const noMap = await runSiteMapAudit({
      projectRoot: repo(),
      gatherer: gatherer({ loadAppMap: () => null, extractors: async () => [] }),
      sessionId: 's-count-0',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(noMap.transition_count).toBe(0);
  });

  it('fires reachability findings for real once the map records transitions (AC-7)', async () => {
    const root = repo();
    const graphMap: AppMap = {
      schema_version: 1,
      app: { name: 'paqad-ai', kind: 'cli' },
      surfaces: [
        {
          id: 's-a',
          kind: 'page',
          label: 'A',
          entry: { kind: 'url', value: '/' },
          transitions: [{ to: 's-b', trigger: 'go' }],
        },
        { id: 's-b', kind: 'page', label: 'B', ends: { success: true } },
        { id: 's-orphan', kind: 'page', label: 'Orphan', ends: { success: true } },
      ],
    };
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({ loadAppMap: () => graphMap, extractors: async () => [] }),
      sessionId: 's-orphan',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.transition_count).toBe(1);
    const findingIndex = readFindingIndex(root, result.bundle_dir);
    expect(findingIndex.findings.map((f) => f.category)).toContain('SM-ORPHAN');
  });

  it('the baseline ratchet marks a known edge pre-existing and a new one new-since-baseline (AC-7)', async () => {
    const root = repo();
    const edgeToC: ExtractedTransition = {
      from_raw_id: 's-a',
      to_target: '/c',
      trigger: 'navigate',
      evidence: [{ file: 'src/a.ts', line: 9 }],
      confidence: 'high',
    };
    await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({
        loadAppMap: () => linkMap,
        extractors: async () => [],
        gatherTransitions: () => [edgeToB],
      }),
      sessionId: 's-ratchet-1',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    const second = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({
        loadAppMap: () => linkMap,
        extractors: async () => [],
        gatherTransitions: () => [edgeToB, edgeToC],
      }),
      sessionId: 's-ratchet-2',
      now: () => new Date(2026, 0, 3, 3, 4, 5),
    });
    const findings = readFindingIndex(root, second.bundle_dir).findings.filter(
      (f) => f.category === 'SM-EDGE-MISSING',
    );
    const toB = findings.find((f) => f.affected_surfaces[1] === 's-b');
    const toC = findings.find((f) => f.affected_surfaces[1] === 's-c');
    expect(toB!.baseline_status).toBe('pre-existing');
    expect(toC!.baseline_status).toBe('new-since-baseline');
  });

  it('surfaces an unresolvable code edge as a transition-resolution blocked check (AC-5)', async () => {
    const root = repo();
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({
        loadAppMap: () => linkMap,
        extractors: async () => [],
        gatherTransitions: () => [{ ...edgeToB, to_target: '/nowhere' }],
      }),
      sessionId: 's-dropped',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
    });
    expect(result.blocked_checks.map((c) => c.check)).toContain('transition-resolution');
  });
});

describe('deriveSiteMapVerdict', () => {
  const clean = { findingCount: 0, hasStoredMap: true, hasTransitions: true, blockedChecks: [] };

  it('is attention whenever there is a finding, even with everything else clean', () => {
    expect(deriveSiteMapVerdict({ ...clean, findingCount: 1 })).toBe('attention');
  });

  it('is inconclusive when there is no stored map', () => {
    expect(deriveSiteMapVerdict({ ...clean, hasStoredMap: false })).toBe('inconclusive');
  });

  it('is inconclusive when the map records no transitions', () => {
    expect(deriveSiteMapVerdict({ ...clean, hasTransitions: false })).toBe('inconclusive');
  });

  it('is inconclusive when a check is blocked', () => {
    expect(
      deriveSiteMapVerdict({
        ...clean,
        blockedChecks: [{ check: 'x', reason: 'r', install_hint: 'h' }],
      }),
    ).toBe('inconclusive');
  });

  it('is safe only when there is a navigable map, no finding, and no blocked check', () => {
    expect(deriveSiteMapVerdict(clean)).toBe('safe');
  });
});

function extractionOf(surfaces: ExtractedSurface[]): ExtractionResult {
  return {
    schema_version: 1,
    app_kind: 'cli',
    surfaces,
    blocked_checks: [],
    fingerprint: 'deadbeef',
    extractors_ran: 1,
    low_confidence_fallback: false,
  };
}

describe('deriveSiteMapInventory', () => {
  it('counts screens, gathers sorted distinct groups, and counts distinct guard tokens (AC-1)', () => {
    const inventory = deriveSiteMapInventory(
      extractionOf([
        surface({ raw_id: 'a', module: 'Billing', guards: ['web', 'auth'] }),
        surface({ raw_id: 'b', module: 'Auth', guards: ['web'] }),
        surface({ raw_id: 'c', module: 'Billing', guards: ['auth', 'verified'] }),
        surface({ raw_id: 'd' }),
      ]),
    );
    expect(inventory.screens).toBe(4);
    expect(inventory.groups).toEqual(['Auth', 'Billing']);
    expect(inventory.guards).toBe(3);
  });

  it('reports zeroes and an empty group set for an empty extraction (AC-2)', () => {
    const inventory = deriveSiteMapInventory(extractionOf([]));
    expect(inventory).toEqual({ screens: 0, groups: [], guards: 0 });
  });
});

describe('describeSiteMapInventory', () => {
  it('is the one shared human sentence (AC-4)', () => {
    expect(describeSiteMapInventory({ screens: 214, groups: ['a', 'b'], guards: 3 })).toBe(
      'Found 214 screens across 2 groups.',
    );
  });
});

describe('runSiteMapAudit inventory (S4)', () => {
  it('returns the inventory and fires onInventory once, before the exit code changes (AC-5)', async () => {
    const root = repo();
    const seen: unknown[] = [];
    const result = await runSiteMapAudit({
      projectRoot: root,
      gatherer: gatherer({
        extractors: async () => [
          {
            extractor: 'node-cli',
            available: true,
            surfaces: [surface({ raw_id: 'a', module: 'Cli', guards: ['auth'] })],
          },
        ],
      }),
      sessionId: 's-inventory',
      now: () => new Date(2026, 0, 2, 3, 4, 5),
      onInventory: (inventory) => seen.push(inventory),
    });
    expect(result.inventory).toEqual({ screens: 1, groups: ['Cli'], guards: 1 });
    expect(seen).toEqual([result.inventory]);
  });
});
