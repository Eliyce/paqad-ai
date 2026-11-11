import { describe, expect, it } from 'vitest';

import { stripOf, trustView } from '../../../../runtime/claude-plugin/mod/desktop-view.ts';
import { parseSnapshot, spanText, stageRuns } from '../../../../runtime/claude-plugin/mod/model.ts';
import { strip } from '../../../../runtime/claude-plugin/mod/strip.ts';
import {
  FAST_ORD_490,
  NOW,
  fileText,
  snapshot,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

type Raw = Record<string, unknown>;

function withBuildRuns(runs: number | undefined): Raw {
  const stages = (FAST_ORD_490.stages as Raw[]).map((entry) =>
    entry.stage === 'development'
      ? {
          ...entry,
          ...(runs === undefined
            ? {}
            : { runs, first_started_at: '2026-10-18T01:00:00.000Z', last_ended_at: null }),
        }
      : entry,
  );
  return snapshot({ ...FAST_ORD_490, stages });
}

function written(raw: Raw): Raw {
  const stages = (raw.stages as Raw[]).map((entry) =>
    Object.fromEntries(
      Object.entries(entry).filter(
        ([key]) => !['runs', 'first_started_at', 'last_ended_at'].includes(key),
      ),
    ),
  );
  return { ...raw, stages };
}

function parsed(raw: Raw) {
  return parseSnapshot(fileText(raw))!;
}

describe('AC-20: the strip shows the run count and the span of a stage that ran again', () => {
  it('shows Build · 5 runs · 8 h 0 min at the default width', () => {
    expect(stripOf(parsed(withBuildRuns(5)), 93, undefined, NOW).stageValue).toBe(
      'Build · 5 runs · 8 h 0 min',
    );
  });

  it('a stage that ran once shows no run count', () => {
    expect(stripOf(parsed(withBuildRuns(1)), 93, undefined, NOW).stageValue).toBe('Build');
  });

  it('the narrow strip drops the span before the run count', () => {
    const input = stripOf(parsed(withBuildRuns(5)), 93, undefined, NOW);
    expect(input.stageValueShort).toBe('Build · 5 runs');
    const wide = strip(input).source;
    expect(wide).toContain('Build · 5 runs · 8 h 0 min');
    const narrow = strip({
      ...input,
      columns: 40,
      signoff: { words: 'Waiting for the design sign-off', tone: 'caut', button: 'Check' },
    }).source;
    expect(narrow).toContain('Build · 5 runs');
    expect(narrow).not.toContain('8 h');
  });

  it('the span moves at most once a minute and is not a live region', () => {
    const at = (ms: number) => stripOf(parsed(withBuildRuns(5)), 93, undefined, ms).stageValue;
    expect(at(NOW + 59_000)).toBe(at(NOW));
    expect(at(NOW + 60_000)).toBe('Build · 5 runs · 8 h 1 min');
    expect(strip(stripOf(parsed(withBuildRuns(5)), 93, undefined, NOW)).source).not.toContain(
      'aria-live',
    );
    expect(spanText(59_999)).toBe('0 min');
    expect(spanText(8 * 3_600_000)).toBe('8 h 0 min');
  });

  it('the Ledger shows the run count and span beside the stage', () => {
    const view = trustView(parsed(withBuildRuns(5)), NOW);
    expect(view.stages.find((stage) => stage.key === 'development')?.span).toBe(
      '5 runs · 8 h 0 min',
    );
    expect(view.stages.find((stage) => stage.key === 'planning')?.span ?? null).toBeNull();
  });
});

describe('AC-22: a snapshot written before runs and span were recorded still draws', () => {
  it('reads an old snapshot with no runs, first_started_at or last_ended_at', () => {
    const old = parsed(written(FAST_ORD_490));
    const build = old.stages.find((stage) => stage.stage === 'development')!;
    expect(build.runs).toBeUndefined();
    expect(stageRuns(build, NOW)).toBeNull();
    const input = stripOf(old, 93, undefined, NOW);
    expect(input.stageValue).toBe('Build');
    expect(() => strip(input)).not.toThrow();
    expect(() => trustView(old, NOW)).not.toThrow();
  });
});
