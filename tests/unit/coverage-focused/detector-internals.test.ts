import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  load: vi.fn(),
  detectEnvironmentTraits: vi.fn(),
  detectShortVideoSignals: vi.fn(),
  buildDetectionReport: vi.fn((input) => input),
}));

vi.mock('@/core/runtime-paths.js', () => ({
  getRuntimeRoot: () => '/runtime',
}));

vi.mock('@/introspection/stack-introspector.js', () => ({
  StackIntrospector: class {
    snapshot = mocks.snapshot;
  },
}));

vi.mock('@/packs/loader.js', () => ({
  StackPackLoader: class {
    load = mocks.load;
  },
}));

vi.mock('@/introspection/environment-traits.js', () => ({
  detectEnvironmentTraits: mocks.detectEnvironmentTraits,
}));

vi.mock('@/detection/signals/short-video.js', () => ({
  detectShortVideoSignals: mocks.detectShortVideoSignals,
}));

vi.mock('@/detection/report.js', () => ({
  buildDetectionReport: mocks.buildDetectionReport,
}));

describe('Detector internals coverage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.load.mockReturnValue({ packs: new Map(), warnings: [] });
    mocks.detectShortVideoSignals.mockReturnValue([]);
    mocks.buildDetectionReport.mockImplementation((input) => input);
  });

  it('falls back to an empty repository context when snapshot.repository is missing', async () => {
    mocks.snapshot.mockResolvedValue({
      repository: undefined,
      packages: [],
    });
    mocks.detectEnvironmentTraits.mockReturnValue({
      traits: [],
      sources: [],
      signals: [],
    });

    const { Detector } = await import('@/detection/detector');
    const report = await new Detector().detect('/repo');

    expect(report.repository).toEqual({
      selected_root: '/repo',
      scan_max_depth: 0,
      ignored_paths: [],
      projects: [],
      applications: [],
      primary_project_root: null,
    });
    expect(report.domain).toBeNull();
    expect(report.stack).toBeNull();
  });

  it('deduplicates identical environment signals across repeated repository roots', async () => {
    mocks.snapshot.mockResolvedValue({
      repository: {
        selected_root: '/repo',
        scan_max_depth: 2,
        ignored_paths: [],
        primary_project_root: '.',
        applications: [],
        projects: [
          { root: '.', role: 'standalone' },
          { root: '.', role: 'standalone' },
        ],
      },
      packages: [],
    });
    mocks.detectEnvironmentTraits.mockReturnValue({
      traits: ['compose'],
      sources: [],
      signals: [
        {
          signal: 'compose file exists',
          file: 'compose.yaml',
          implies: 'compose',
          confidence: 'high',
        },
      ],
    });

    const { Detector } = await import('@/detection/detector');
    const report = await new Detector().detect('/repo');

    expect(report.signals).toEqual([
      {
        signal: 'compose file exists',
        file: 'compose.yaml',
        implies: 'compose',
        confidence: 'high',
      },
    ]);
    expect(report.detectedTraits).toEqual(['compose']);
  });
});
