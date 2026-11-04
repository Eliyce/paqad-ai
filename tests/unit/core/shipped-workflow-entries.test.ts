import { describe, expect, it } from 'vitest';

import {
  isShippedWorkflowEntry,
  SHIPPED_WORKFLOW_ENTRIES,
  shippedWorkflowEntryHash,
} from '@/core/shipped-workflow-entries.js';
import { WORKFLOW_POLICY_STAGES } from '@/core/team-config-schema.js';
import { defaultFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';

import {
  collectEntriesFromSource,
  renderHashList,
  shippedEntryHash,
  // @ts-expect-error the generator is a plain script with no types
} from '../../../scripts/shipped-workflow-hashes.mjs';

const REUSE_TAIL =
  'for existing helpers; follow the solution-architect procedure — Reuse / Extend / Build-new, and record a rejection rationale for every Build-new.';
const REUSE_CURRENT = `Reuse before you build: consult the Existing surface section (and \`paqad-ai index query <name>\`) ${REUSE_TAIL}`;
const REUSE_OLDER = `Reuse before you build: consult the Existing surface section (and \`npx paqad-ai index query <name>\`) ${REUSE_TAIL}`;

interface StageEntries {
  read: readonly string[];
  instructions: readonly string[];
}

function missingFromList(stages: Readonly<Record<string, StageEntries>>): string[] {
  const missing: string[] = [];
  for (const [stage, entries] of Object.entries(stages)) {
    for (const kind of ['read', 'instructions'] as const) {
      for (const text of entries[kind]) {
        if (!isShippedWorkflowEntry(stage, kind, text)) {
          missing.push(`${stage} ${kind}: add ${shippedWorkflowEntryHash(text)} for ${text}`);
        }
      }
    }
  }
  return missing;
}

function currentDefaults(): Record<string, StageEntries> {
  const { stages } = defaultFeatureDevelopmentPolicy();
  return Object.fromEntries(WORKFLOW_POLICY_STAGES.map((stage) => [stage, stages[stage]]));
}

describe('the list of workflow entries paqad has shipped', () => {
  it('AC-3: matches both index query wordings, ignores extra whitespace and respects the stage', () => {
    expect(isShippedWorkflowEntry('planning', 'instructions', REUSE_CURRENT)).toBe(true);
    expect(isShippedWorkflowEntry('planning', 'instructions', REUSE_OLDER)).toBe(true);
    expect(
      isShippedWorkflowEntry(
        'planning',
        'instructions',
        `  ${REUSE_OLDER.replaceAll(' ', '  \n ')}\n`,
      ),
    ).toBe(true);
    expect(isShippedWorkflowEntry('review', 'instructions', REUSE_CURRENT)).toBe(false);
    expect(isShippedWorkflowEntry('planning', 'read', REUSE_CURRENT)).toBe(false);
  });

  it('AC-6: lists the two folders the owner named and no folder paqad never shipped', () => {
    expect(isShippedWorkflowEntry('planning', 'read', 'docs/modules/**')).toBe(true);
    expect(isShippedWorkflowEntry('planning', 'read', 'docs/instructions/**')).toBe(true);
    expect(isShippedWorkflowEntry('planning', 'read', 'docs/our-own/**')).toBe(false);
  });

  it('AC-1: never lists an instruction the team wrote', () => {
    expect(isShippedWorkflowEntry('planning', 'instructions', 'Verify test coverage is 100%')).toBe(
      false,
    );
  });

  it('AC-4: holds every current default entry', () => {
    expect(missingFromList(currentDefaults())).toEqual([]);
  });

  it('AC-4: the guard fails on a missing entry and prints the hash to add', () => {
    const stages = currentDefaults();
    const unlisted = 'A brand new default instruction.';
    const missing = missingFromList({
      ...stages,
      review: { read: [], instructions: [...stages.review!.instructions, unlisted] },
    });
    expect(missing).toEqual([
      `review instructions: add ${shippedWorkflowEntryHash(unlisted)} for ${unlisted}`,
    ]);
  });

  it('keys the list by the seven workflow stages', () => {
    expect(Object.keys(SHIPPED_WORKFLOW_ENTRIES).sort()).toEqual(
      [...WORKFLOW_POLICY_STAGES].sort(),
    );
  });
});

const wrap = (instructions: string, template = ''): string => `
const FIRST = 'one ' + 'two';
function extras(lane) {
  const list = [FIRST];
  if (lane) {
    list.push('pushed');
  }
  return list;
}
export function defaultFeatureDevelopmentPolicy() {
  return { stages: { planning: { read: ['docs/a/**'], instructions: ${instructions} } } };
}
export function renderDefaultFeatureDevelopmentPolicyYaml() {
  return \`${template}\`;
}
`;

describe('the shipped hash generator', () => {
  it('reads stage objects through consts, concatenation, spreads and a local function', () => {
    const entries = collectEntriesFromSource(wrap("[FIRST, ...extras('full'), `plain`]"), 'one');
    expect([...entries.planning.instructions]).toEqual(['one two', 'pushed', 'plain']);
    expect([...entries.planning.read]).toEqual(['docs/a/**']);
  });

  it('reads the embedded stages template, including an item YAML reads as a pair', () => {
    const template = [
      'stages:',
      '  delivery:',
      '    instructions:',
      '      - Render from the conventions: block templates',
      '      - plain text',
      '  planning:',
      '    read:',
      '      - docs/b/**',
    ].join('\n');
    const entries = collectEntriesFromSource(wrap('[FIRST]', template), 'one');
    expect([...entries.delivery.instructions]).toEqual([
      'Render from the conventions: block templates',
      'plain text',
    ]);
    expect([...entries.planning.read]).toEqual(['docs/a/**', 'docs/b/**']);
  });

  it('stops on an element it cannot resolve', () => {
    expect(() => collectEntriesFromSource(wrap('[someCall()]'), 'abc123')).toThrow(
      /abc123: can't resolve/,
    );
    expect(() => collectEntriesFromSource(wrap('[UNKNOWN]'), 'abc123')).toThrow(
      /abc123: can't resolve UNKNOWN/,
    );
    expect(() =>
      collectEntriesFromSource(
        wrap('[FIRST]', 'stages:\n  planning:\n    instructions:\n      - [nested]\n'),
        'abc123',
      ),
    ).toThrow(/isn't text/);
  });

  it('hashes the same way as the shipped list and renders that list', () => {
    expect(shippedEntryHash(' a \n b ')).toBe(shippedWorkflowEntryHash('a b'));
    const entries = collectEntriesFromSource(wrap('[FIRST]'), 'one');
    const rendered = renderHashList(entries) as string;
    expect(rendered).toContain('export const SHIPPED_WORKFLOW_ENTRIES');
    expect(rendered).toContain(`'${shippedWorkflowEntryHash('one two')}'`);
  });
});
