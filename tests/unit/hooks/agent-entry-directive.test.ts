import { describe, expect, it } from 'vitest';

import {
  loadSteps,
  SPEC_PIPELINE_DEFAULTS_MIRROR,
  specPipelineNudge,
} from '../../../runtime/hooks/lib/agent-entry-directive.mjs';
import { SPEC_PIPELINE_DEFAULTS } from '@/core/framework-config.js';

function reader(values: Record<string, string>) {
  return (_root: string, key: string): string | undefined => values[key];
}

describe('loadSteps', () => {
  it('tells the agent to read the entry + framework files with its file-read tool', () => {
    const steps = loadSteps('CLAUDE.md').join('\n');
    expect(steps).toContain('Read CLAUDE.md with your file-read tool');
    expect(steps).toContain('read the framework gate (AGENT-BOOTSTRAP.md');
    expect(steps).toContain('file-read tool');
    expect(steps).not.toMatch(/\bcat\b|echo =+/);
  });
});

describe('loadSteps sentinel path', () => {
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

  it('reports the pipeline ON, experts ON and adoption strict when nothing is set', () => {
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

describe('specPipelineNudge by route and lane', () => {
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

describe('spec-pipeline default mirror', () => {
  it('matches SPEC_PIPELINE_DEFAULTS exactly', () => {
    expect({ ...SPEC_PIPELINE_DEFAULTS_MIRROR }).toEqual({ ...SPEC_PIPELINE_DEFAULTS });
  });
});
