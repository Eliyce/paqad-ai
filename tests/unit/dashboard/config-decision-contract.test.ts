import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DecisionContractValidationError,
  getDecisionContract,
  putDecisionContract,
} from '@/dashboard/config-decision-contract.js';
import { contentHash, WriteConflictError } from '@/dashboard/write-pipeline.js';

const CONTRACT_PATH = '.paqad/decision-pause-contract.md';

const VALID_CONTRACT = [
  '# Decision Pause Contract',
  '',
  'Pause before implementing any choice in the categories below.',
  '',
].join('\n');

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('decision contract config endpoint logic', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-config-dc-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('getDecisionContract', () => {
    it('returns a missing file on a bare project', () => {
      const file = getDecisionContract(root);
      expect(file.exists).toBe(false);
      expect(file.content).toBeNull();
      expect(file.hash).toBeNull();
    });

    it('returns the content and hash when the contract exists', () => {
      write(root, CONTRACT_PATH, VALID_CONTRACT);
      const file = getDecisionContract(root);
      expect(file.exists).toBe(true);
      expect(file.content).toBe(VALID_CONTRACT);
      expect(file.hash).toBe(contentHash(VALID_CONTRACT));
    });
  });

  describe('putDecisionContract', () => {
    it('writes, audits, and returns the new hash', () => {
      const result = putDecisionContract(root, { content: VALID_CONTRACT, baseHash: null });

      expect(result.path).toBe(CONTRACT_PATH);
      expect(result.hash).toBe(contentHash(VALID_CONTRACT));
      expect(readFileSync(join(root, CONTRACT_PATH), 'utf8')).toBe(VALID_CONTRACT);
      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.config.decision-contract.write');
      expect(audit).toContain('actor="dashboard"');
    });

    it('rejects empty content and writes nothing', () => {
      expect(() => putDecisionContract(root, { content: '   \n', baseHash: null })).toThrow(
        DecisionContractValidationError,
      );
      expect(() => readFileSync(join(root, CONTRACT_PATH), 'utf8')).toThrow();
    });

    it('rejects content that drops the canonical heading', () => {
      let error: DecisionContractValidationError | null = null;
      try {
        putDecisionContract(root, {
          content: '## Decision Pause Contract\n\nDemoted heading.\n',
          baseHash: null,
        });
      } catch (err) {
        error = err as DecisionContractValidationError;
      }
      expect(error).toBeInstanceOf(DecisionContractValidationError);
      expect(error?.issues[0]?.message).toContain('# Decision Pause Contract');
    });

    it('propagates a write conflict when the file changed underneath', () => {
      write(root, CONTRACT_PATH, VALID_CONTRACT);
      expect(() =>
        putDecisionContract(root, {
          content: `${VALID_CONTRACT}\nMore.\n`,
          baseHash: contentHash('something stale'),
        }),
      ).toThrow(WriteConflictError);
    });

    it('accepts an update that echoes the current hash', () => {
      write(root, CONTRACT_PATH, VALID_CONTRACT);
      const updated = `${VALID_CONTRACT}\nAdded a category.\n`;
      const result = putDecisionContract(root, {
        content: updated,
        baseHash: contentHash(VALID_CONTRACT),
      });
      expect(result.hash).toBe(contentHash(updated));
    });
  });
});
