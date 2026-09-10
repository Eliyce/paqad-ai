import { describe, expect, it } from 'vitest';

// The runtime .mjs directive module (issue #547, FR-1.4). Imported directly; it takes a config
// reader so the test needs no filesystem.
import { specPipelineNudge } from '../../../runtime/hooks/lib/agent-entry-directive.mjs';

/** A fake layered-config reader backed by a plain record. */
function reader(values: Record<string, string>) {
  return (_root: string, key: string): string | undefined => values[key];
}

describe('specPipelineNudge (FR-1.4)', () => {
  it('is null when the pipeline is off (byte-identical output, INV-1)', () => {
    expect(specPipelineNudge(reader({}), '/x')).toBeNull();
    expect(specPipelineNudge(reader({ spec_pipeline_enabled: 'false' }), '/x')).toBeNull();
  });

  it('reports experts OFF and adoption warn by default', () => {
    const line = specPipelineNudge(reader({ spec_pipeline_enabled: 'true' }), '/x');
    expect(line).toBe(
      '[paqad] Spec pipeline: ON (experts: OFF, adoption: warn). For a code change, the specification stage runs `paqad-ai spec pipeline start`, not a hand-written spec.',
    );
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
