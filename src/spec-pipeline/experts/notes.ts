// Validate the expert NOTES artifact and read/write the experts scratch (issue #521, FR-6/FR-7).
//
// After the roster decision (need.ts) the experts run and hand back structured notes plus their
// token actuals. This module validates that returned artifact against the roster (an expert that
// was never in the need set cannot smuggle notes in) and owns the small scratch files the run
// keeps alongside the pipeline steps. Deterministic; zero model tokens.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AgentRole } from '@/core/types/agent.js';

import { pipelineScratchDir } from '../orchestrator.js';
import { isExpertRole } from './roster.js';
import type { ExpertNote } from './types.js';

/** The notes each expert returned, plus the tokens they actually spent. */
export interface ExpertNotesArtifact {
  notes: ExpertNote[];
  tokens: Partial<Record<AgentRole, number>>;
}

export interface ExpertNotesValidation {
  ok: boolean;
  error?: string;
  artifact?: ExpertNotesArtifact;
}

function fail(error: string): ExpertNotesValidation {
  return { ok: false, error };
}

/**
 * Validate a raw notes artifact. `notes[]` is required; each note names a roster role and a
 * `findings[]` of `{ target, claim }` non-empty strings. `tokens` is optional and maps roster
 * roles to non-negative numbers. Rejects a role outside the roster (the guard extends to notes,
 * not just the need decision).
 */
export function validateExpertNotes(raw: unknown): ExpertNotesValidation {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  if (parsed === undefined) return fail('expert-notes artifact is not valid JSON');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('expert-notes artifact must be an object with a notes[] array');
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.notes)) return fail('expert-notes artifact needs a notes[] array');

  const notes: ExpertNote[] = [];
  for (const [index, entry] of obj.notes.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return fail(`notes[${index}] must be an object with role and findings`);
    }
    const { role, findings } = entry as Record<string, unknown>;
    if (typeof role !== 'string' || !isExpertRole(role)) {
      return fail(`notes[${index}].role "${String(role)}" is not an expert in the roster`);
    }
    if (!Array.isArray(findings)) {
      return fail(`notes[${index}] ("${role}") needs a findings[] array`);
    }
    const parsedFindings = [];
    for (const [fi, finding] of findings.entries()) {
      if (typeof finding !== 'object' || finding === null || Array.isArray(finding)) {
        return fail(`notes[${index}].findings[${fi}] must be an object with target and claim`);
      }
      const { target, claim } = finding as Record<string, unknown>;
      if (typeof target !== 'string' || target.trim().length === 0) {
        return fail(`notes[${index}].findings[${fi}] needs a non-empty target`);
      }
      if (typeof claim !== 'string' || claim.trim().length === 0) {
        return fail(`notes[${index}].findings[${fi}] needs a non-empty claim`);
      }
      parsedFindings.push({ target, claim });
    }
    notes.push({ role, findings: parsedFindings });
  }

  const tokens: Partial<Record<AgentRole, number>> = {};
  if (obj.tokens !== undefined) {
    if (typeof obj.tokens !== 'object' || obj.tokens === null || Array.isArray(obj.tokens)) {
      return fail('expert-notes "tokens" must be an object of role -> number');
    }
    for (const [role, value] of Object.entries(obj.tokens as Record<string, unknown>)) {
      if (!isExpertRole(role)) return fail(`tokens names "${role}", which is not an expert role`);
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return fail(`tokens["${role}"] must be a non-negative number`);
      }
      tokens[role] = value;
    }
  }

  return { ok: true, artifact: { notes, tokens } };
}

/** Path to the need scratch artifact (the roster decision). */
export function expertNeedPath(dirName: string): string {
  return join(pipelineScratchDir(dirName), 'experts.json');
}

/** Path to the notes scratch artifact (what the experts returned). */
export function expertNotesPath(dirName: string): string {
  return join(pipelineScratchDir(dirName), 'expert-notes.json');
}

function writeJson(abs: string, value: unknown): void {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** Write the validated need artifact to the pipeline scratch. */
export function writeExpertNeed(projectRoot: string, dirName: string, value: unknown): void {
  writeJson(join(projectRoot, expertNeedPath(dirName)), value);
}

/** Write the validated notes artifact to the pipeline scratch. */
export function writeExpertNotes(projectRoot: string, dirName: string, value: unknown): void {
  writeJson(join(projectRoot, expertNotesPath(dirName)), value);
}

/** Read the stored need artifact, or null when the experts step never ran. */
export function readExpertNeed(projectRoot: string, dirName: string): unknown | null {
  return readJson(join(projectRoot, expertNeedPath(dirName)));
}

/** Read the stored notes artifact, or null when no notes were recorded. */
export function readExpertNotes(projectRoot: string, dirName: string): unknown | null {
  return readJson(join(projectRoot, expertNotesPath(dirName)));
}

function readJson(abs: string): unknown | null {
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
