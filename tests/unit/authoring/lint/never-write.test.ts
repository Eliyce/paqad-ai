import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  compileNeverWritePattern,
  frameworkNeverWritePath,
  loadNeverWriteList,
  NeverWriteListError,
  PROJECT_NEVER_WRITE_PATH,
} from '@/authoring/lint/never-write.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(listText?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-never-write-'));
  roots.push(root);
  if (listText !== undefined) {
    mkdirSync(join(root, 'docs/instructions/rules/authoring'), { recursive: true });
    writeFileSync(join(root, PROJECT_NEVER_WRITE_PATH), listText);
  }
  return root;
}

describe('the framework never-write list', () => {
  it('ships schema_version "1" with the 15 initial phrases', () => {
    const shipped = YAML.parse(readFileSync(frameworkNeverWritePath(), 'utf8')) as {
      schema_version: string;
      phrases: string[];
    };
    expect(shipped.schema_version).toBe('1');
    expect(shipped.phrases).toHaveLength(15);
    expect(shipped.phrases).toContain('follow best practices');
    const list = loadNeverWriteList();
    expect(list.phrases).toEqual(shipped.phrases);
    expect(list.framework_phrases).toBe(15);
    expect(list.project_phrases).toBe(0);
  });
});

describe('the project union', () => {
  it('adds project phrases after the framework ones, without duplicates', () => {
    const root = project(
      'schema_version: "1"\nphrases:\n  - circle back\n  - Leverage\n  - synergy\n',
    );
    const list = loadNeverWriteList(root);
    expect(list.phrases.slice(0, 15)).toEqual(loadNeverWriteList().phrases);
    expect(list.phrases.slice(15)).toEqual(['circle back', 'synergy']);
    expect(list.project_phrases).toBe(2);
  });

  it('can never remove a framework phrase', () => {
    const root = project('schema_version: "1"\nphrases: []\n');
    expect(loadNeverWriteList(root).phrases).toHaveLength(15);
  });

  it('works without a project file', () => {
    expect(loadNeverWriteList(project()).phrases).toHaveLength(15);
  });

  it('refuses a project file with the wrong schema or a malformed list', () => {
    expect(() => loadNeverWriteList(project('schema_version: "2"\nphrases: []\n'))).toThrow(
      NeverWriteListError,
    );
    expect(() => loadNeverWriteList(project('schema_version: "1"\nphrases: [1, 2]\n'))).toThrow(
      /list of strings/,
    );
    expect(() => loadNeverWriteList(project('schema_version: "1"\nphrases: [a\n'))).toThrow(
      /not valid YAML/,
    );
  });
});

describe('compileNeverWritePattern', () => {
  it('matches whole phrases case-insensitively across any whitespace', () => {
    const pattern = compileNeverWritePattern(['make sure to', 'leverage']);
    expect('Make  sure to check'.match(pattern)).toEqual(['Make  sure to']);
    expect('leveraged'.match(pattern)).toBeNull();
  });
});
