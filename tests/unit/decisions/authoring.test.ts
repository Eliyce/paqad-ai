import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  addWriteInOption,
  assertContractDecisionId,
  createPendingDecision,
  isContractDecisionId,
  listContractDecisions,
  mintDecisionId,
  resolvePendingDecision,
  type CreateDecisionInput,
} from '@/decisions/authoring.js';
import { writeFileSync } from 'node:fs';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-decision-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const validInput = (): CreateDecisionInput => ({
  category: 'workflow-or-tool',
  title: 'Where should the script live?',
  context: 'The issue defers this choice to us.',
  options: [
    { option_key: 'standalone', label: 'Standalone scripts/ helper' },
    { option_key: 'skill', label: 'Skill-bundled script' },
  ],
});

function pendingPath(id: string): string {
  return join(root, PATHS.DECISIONS_PENDING_DIR, `${id}.json`);
}

function resolvedPath(id: string): string {
  return join(root, PATHS.DECISIONS_RESOLVED_DIR, `${id}.json`);
}

describe('mintDecisionId / isContractDecisionId', () => {
  it('mints the collision-free D-<ULID> form', () => {
    const id = mintDecisionId();
    expect(id).toMatch(/^D-[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(isContractDecisionId(id)).toBe(true);
  });

  it('mints strictly increasing ids within a process (sortable)', () => {
    const ids = Array.from({ length: 5 }, () => mintDecisionId());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects the legacy sequential and malformed forms', () => {
    expect(isContractDecisionId('D-4')).toBe(false);
    expect(isContractDecisionId('D-1')).toBe(false);
    expect(isContractDecisionId('4')).toBe(false);
    expect(isContractDecisionId('D-01KWF47XSPQAH4KC4B3YYXC7CT')).toBe(true);
    // ULID excludes I/L/O/U — a lookalike with those must not pass.
    expect(isContractDecisionId('D-0IKWF47XSPQAH4KC4B3YYXC7CT')).toBe(false);
  });

  it('assertContractDecisionId throws only for a non-ULID id', () => {
    expect(() => assertContractDecisionId('D-4')).toThrow(/D-<ULID>/u);
    expect(() => assertContractDecisionId(mintDecisionId())).not.toThrow();
  });
});

describe('createPendingDecision', () => {
  it('mints an id and writes a well-formed pending packet', () => {
    const { id, path } = createPendingDecision(root, validInput());

    expect(isContractDecisionId(id)).toBe(true);
    expect(path).toBe(pendingPath(id));
    expect(existsSync(path)).toBe(true);

    const packet = JSON.parse(readFileSync(path, 'utf8'));
    expect(packet).toMatchObject({
      id,
      category: 'workflow-or-tool',
      title: 'Where should the script live?',
      status: 'pending',
      recommendation: null,
    });
    expect(packet.options).toHaveLength(2);
    expect(typeof packet.created_at).toBe('string');
    expect(Number.isNaN(Date.parse(packet.created_at))).toBe(false);
    // File ends with a trailing newline (atomic JSON write).
    expect(readFileSync(path, 'utf8').endsWith('}\n')).toBe(true);
  });

  it('keeps a supplied recommendation that references an option', () => {
    const { path } = createPendingDecision(root, {
      ...validInput(),
      recommendation: 'skill',
    });
    expect(JSON.parse(readFileSync(path, 'utf8')).recommendation).toBe('skill');
  });

  it.each([
    [{ category: '  ' }, /category is required/u],
    [{ title: '' }, /title is required/u],
    [{ context: '' }, /context is required/u],
    [{ options: [{ option_key: 'only', label: 'One' }] }, /at least 2 options/u],
    [
      {
        options: [
          { option_key: '', label: 'A' },
          { option_key: 'b', label: 'B' },
        ],
      },
      /option_key is required/u,
    ],
    [
      {
        options: [
          { option_key: 'a', label: '' },
          { option_key: 'b', label: 'B' },
        ],
      },
      /options\[0\]\.label is required/u,
    ],
    [
      {
        options: [
          { option_key: 'dup', label: 'A' },
          { option_key: 'dup', label: 'B' },
        ],
      },
      /duplicated/u,
    ],
    [{ recommendation: 'missing' }, /recommendation must reference an option_key/u],
  ])('rejects invalid input (%#)', (patch, expected) => {
    expect(() =>
      createPendingDecision(root, { ...validInput(), ...patch } as CreateDecisionInput),
    ).toThrow(expected);
  });
});

describe('resolvePendingDecision', () => {
  it('moves the packet to resolved and stamps the decision', () => {
    const { id } = createPendingDecision(root, validInput());
    const { path, packet } = resolvePendingDecision(
      root,
      id,
      'skill',
      'Team chose the skill route.',
    );

    expect(path).toBe(resolvedPath(id));
    expect(existsSync(pendingPath(id))).toBe(false);
    expect(existsSync(resolvedPath(id))).toBe(true);

    expect(packet).toMatchObject({
      id,
      status: 'resolved',
      chosen: 'skill',
      rationale: 'Team chose the skill route.',
    });
    expect(Number.isNaN(Date.parse(packet.resolved_at))).toBe(false);

    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    expect(onDisk.chosen).toBe('skill');
  });

  it('defaults the rationale to an empty string', () => {
    const { id } = createPendingDecision(root, validInput());
    const { packet } = resolvePendingDecision(root, id, 'standalone');
    expect(packet.rationale).toBe('');
  });

  it('rejects a chosen option that is not offered', () => {
    const { id } = createPendingDecision(root, validInput());
    expect(() => resolvePendingDecision(root, id, 'nope')).toThrow(
      /not one of the packet's options/u,
    );
    // The packet stays pending on a failed resolve.
    expect(existsSync(pendingPath(id))).toBe(true);
  });

  it('rejects a non-ULID id before touching the filesystem', () => {
    expect(() => resolvePendingDecision(root, 'D-4', 'skill')).toThrow(/D-<ULID>/u);
  });

  it('throws when the pending packet does not exist', () => {
    expect(() => resolvePendingDecision(root, mintDecisionId(), 'skill')).toThrow(/not found/u);
  });
});

describe('listContractDecisions (#326)', () => {
  it('is empty for a project with no decisions dir', () => {
    expect(listContractDecisions(root)).toEqual([]);
  });

  it('lists pending then resolved packets, skipping malformed files', () => {
    const pending = createPendingDecision(root, validInput()).id;
    const resolveMe = createPendingDecision(root, validInput()).id;
    resolvePendingDecision(root, resolveMe, 'skill');
    // A malformed pending file must not break the listing.
    writeFileSync(join(root, PATHS.DECISIONS_PENDING_DIR, 'junk.json'), '{ not json');

    const rows = listContractDecisions(root);
    expect(rows.find((r) => r.id === pending)?.status).toBe('pending');
    expect(rows.find((r) => r.id === resolveMe)?.status).toBe('resolved');
  });
});

describe('addWriteInOption (#326)', () => {
  it('appends a write-in option and returns its key', () => {
    const { id } = createPendingDecision(root, validInput());
    expect(addWriteInOption(root, id, 'A third way')).toBe('other');
    const { packet } = resolvePendingDecision(root, id, 'other');
    expect(packet.options.some((o) => o.option_key === 'other' && o.label === 'A third way')).toBe(
      true,
    );
  });

  it('mints a non-colliding key when "other" already exists', () => {
    const { id } = createPendingDecision(root, {
      ...validInput(),
      options: [
        { option_key: 'other', label: 'Existing other' },
        { option_key: 'skill', label: 'Skill' },
      ],
    });
    expect(addWriteInOption(root, id, 'Another')).toBe('other-2');
  });

  it('rejects an empty label and a missing/invalid packet', () => {
    const { id } = createPendingDecision(root, validInput());
    expect(() => addWriteInOption(root, id, '  ')).toThrow(/non-empty label/u);
    expect(() => addWriteInOption(root, 'D-4', 'x')).toThrow(/D-<ULID>/u);
    expect(() => addWriteInOption(root, mintDecisionId(), 'x')).toThrow(/not found/u);
  });
});
