import { describe, expect, it } from 'vitest';

// The runtime .mjs directive module (issue #547, FR-1.4). Imported directly; it takes a config
// reader so the test needs no filesystem.
import {
  loadSteps,
  SPEC_PIPELINE_DEFAULTS_MIRROR,
  specPipelineNudge,
} from '../../../runtime/hooks/lib/agent-entry-directive.mjs';
import { SPEC_PIPELINE_DEFAULTS } from '@/core/framework-config.js';

/** A fake layered-config reader backed by a plain record. */
function reader(values: Record<string, string>) {
  return (_root: string, key: string): string | undefined => values[key];
}

// Issue #576 (Finding 11) — the load steps must steer the agent to its file-read tool, so it does
// not reach for a shell `cat AGENT-BOOTSTRAP.md; echo =====; ...` one-liner that hits the zsh `=`
// command trap and prints a scary "Failed to load" at every session start.
describe('loadSteps (issue #576, Finding 11)', () => {
  it('tells the agent to read the entry + framework files with its file-read tool', () => {
    const steps = loadSteps('CLAUDE.md').join('\n');
    expect(steps).toContain('Read CLAUDE.md with your file-read tool');
    expect(steps).toContain('read the framework gate (AGENT-BOOTSTRAP.md');
    expect(steps).toContain('file-read tool');
    // It must not suggest a shell command for reading the files.
    expect(steps).not.toMatch(/\bcat\b|echo =+/);
  });
});

// Issue #582 — the last step names the exact sentinel file the gate checks for this session.
describe('loadSteps sentinel path (issue #582)', () => {
  it('names the legacy sentinel by default', () => {
    expect(loadSteps('CLAUDE.md').at(-1)).toBe(
      '[paqad]   5. Write .paqad/.agent-entry-loaded with timestamp + entry-file path',
    );
  });

  it('names the per-session sentinel when one is given', () => {
    expect(loadSteps('CLAUDE.md', '.paqad/.agent-entry-loaded.d/s-1').at(-1)).toBe(
      '[paqad]   5. Write .paqad/.agent-entry-loaded.d/s-1 with timestamp + entry-file path',
    );
  });
});

describe('specPipelineNudge (FR-1.4)', () => {
  it('is null when the pipeline is switched off (byte-identical output, INV-1)', () => {
    expect(specPipelineNudge(reader({ spec_pipeline_enabled: 'false' }), '/x')).toBeNull();
    expect(specPipelineNudge(reader({ spec_pipeline_enabled: 'OFF' }), '/x')).toBeNull();
  });

  it('reports the pipeline ON, experts ON and adoption strict when nothing is set (#640 AC-16)', () => {
    expect(specPipelineNudge(reader({}), '/x')).toBe(
      '[paqad] Spec pipeline: ON (experts: ON, adoption: strict). For a code change, the specification stage runs `paqad-ai spec pipeline start`, not a hand-written spec.',
    );
  });

  it('degrades unrecognised values to the defaults (RULE-16)', () => {
    const line = specPipelineNudge(
      reader({
        spec_pipeline_enabled: 'maybe',
        spec_pipeline_experts_enabled: 'perhaps',
        spec_pipeline_adoption: 'banana',
      }),
      '/x',
    );
    expect(line).toMatch(/experts: ON, adoption: strict/);
  });

  it('reports experts OFF and adoption warn when the project set them so (AC-18)', () => {
    const line = specPipelineNudge(
      reader({ spec_pipeline_experts_enabled: 'no', spec_pipeline_adoption: 'Warn' }),
      '/x',
    );
    expect(line).toMatch(/Spec pipeline: ON \(experts: OFF, adoption: warn\)/);
  });

  it('reports experts ON and adoption strict when set', () => {
    const line = specPipelineNudge(
      reader({
        spec_pipeline_enabled: 'true',
        spec_pipeline_experts_enabled: 'on',
        spec_pipeline_adoption: 'strict',
      }),
      '/x',
    );
    expect(line).toMatch(/experts: ON, adoption: strict/);
  });
});

// Issue #640 (FR-14, AC-21) — the nudge follows this prompt's route and lane.
describe('specPipelineNudge by route and lane (issue #640, FR-14)', () => {
  const env = {};
  it('is silent on the fast lane', () => {
    expect(
      specPipelineNudge(reader({}), '/x', env, { routed: 'feature-development', lane: 'fast' }),
    ).toBeNull();
  });

  it('is silent on a route that is not feature-development', () => {
    expect(
      specPipelineNudge(reader({}), '/x', env, { routed: 'project-question', lane: null }),
    ).toBeNull();
  });

  it.each(['graduated', 'full', null])('nudges on the %s lane with the defaults', (lane) => {
    expect(
      specPipelineNudge(reader({}), '/x', env, { routed: 'feature-development', lane }),
    ).toMatch(/Spec pipeline: ON \(experts: ON, adoption: strict\)/);
  });

  it('stays null on the graduated lane when the project switched the pipeline off', () => {
    expect(
      specPipelineNudge(reader({ spec_pipeline_enabled: 'false' }), '/x', env, {
        routed: 'feature-development',
        lane: 'graduated',
      }),
    ).toBeNull();
  });
});

// Issue #640 (AC-24) — the hook cannot import TypeScript, so it mirrors the three defaults. This
// test is the drift guard: change one side without the other and it fails.
describe('spec-pipeline default mirror (issue #640, AC-24)', () => {
  it('matches SPEC_PIPELINE_DEFAULTS exactly', () => {
    expect({ ...SPEC_PIPELINE_DEFAULTS_MIRROR }).toEqual({ ...SPEC_PIPELINE_DEFAULTS });
  });
});
