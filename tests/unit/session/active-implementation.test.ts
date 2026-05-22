import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  applyActiveImplementationSession,
  createActiveImplementationSession,
  isExplicitExplanationOnlyIntent,
  readActiveImplementationSession,
  writeActiveImplementationSession,
} from '@/session/active-implementation.js';

import { fixtureClassification } from '../pipeline/shared.fixture.js';

describe('active implementation session helpers', () => {
  it('marks implementation work active while verification is still pending', () => {
    const artifact = createActiveImplementationSession(
      fixtureClassification({
        workflow: 'feature-development',
        scope: 'multi-module',
        affected_modules: ['src/pipeline', 'src/session'],
      }),
      'graduated',
      'implementation-review',
      [
        {
          phase: 'implementation',
          status: 'pass',
          summary: 'Implementation completed',
          artifacts: [],
        },
      ],
      {
        files: ['src/pipeline/classifier.ts', 'tests/unit/pipeline/classifier.test.ts'],
        source: 'session-artifact',
      },
    );

    expect(artifact.active).toBe(true);
    expect(artifact.has_code_changes).toBe(true);
    expect(artifact.pending_verification).toBe(true);
    expect(artifact.pending_documentation).toBe(true);
  });

  it('treats test-only changes as code that still needs verification', () => {
    const artifact = createActiveImplementationSession(
      fixtureClassification({
        workflow: 'bug-fix',
        scope: 'single-module',
        affected_modules: ['tests/unit/pipeline'],
      }),
      'fast',
      'implementation-review',
      [],
      {
        files: ['tests/unit/pipeline/classifier.test.ts'],
        source: 'session-artifact',
      },
    );

    expect(artifact.has_code_changes).toBe(true);
    expect(artifact.pending_verification).toBe(true);
  });

  it('marks implementation work inactive once verification and documentation pass', () => {
    const artifact = createActiveImplementationSession(
      fixtureClassification({
        workflow: 'feature-development',
        scope: 'single-module',
        affected_modules: ['src/pipeline'],
      }),
      'graduated',
      'documentation-update',
      [
        {
          phase: 'verification-gates',
          status: 'pass',
          summary: 'Verification gates passed',
          artifacts: [],
        },
        {
          phase: 'documentation-update',
          status: 'pass',
          summary: 'Canonical docs updated',
          artifacts: [],
        },
      ],
      {
        files: ['src/pipeline/classifier.ts', 'docs/modules/pipeline/index/summary.md'],
        source: 'session-artifact',
      },
    );

    expect(artifact.active).toBe(false);
    expect(artifact.pending_verification).toBe(false);
    expect(artifact.pending_documentation).toBe(false);
  });

  it('resumes implementation routing for question-only follow-ups', () => {
    const resolutionMap: Record<string, string> = {
      workflow: 'deterministic',
      affected_modules: 'default',
    };
    const decision = applyActiveImplementationSession(
      'why',
      fixtureClassification({
        workflow: 'project-question',
        scope: 'single-module',
        affected_modules: [],
        complexity: 'low',
        risk: 'low',
      }),
      {
        version: 1,
        updated_at: new Date().toISOString(),
        active: true,
        workflow: 'feature-development',
        lane: 'full',
        current_phase: 'implementation-review',
        scope: 'multi-module',
        affected_modules: ['src/pipeline', 'src/session'],
        changed_files: ['src/pipeline/classifier.ts'],
        changed_files_source: 'session-artifact',
        has_code_changes: true,
        pending_verification: true,
        pending_documentation: true,
        unresolved_items: ['Verification blocked'],
      },
      resolutionMap,
    );

    expect(decision.resumed).toBe(true);
    expect(decision.classification.workflow).toBe('feature-development');
    expect(decision.classification.workflow_source).toBe('active-session');
    expect(decision.classification.resume_lane).toBe('full');
    expect(decision.classification.affected_modules).toEqual(['src/pipeline', 'src/session']);
    expect(resolutionMap.workflow).toBe('session-resume');
    expect(resolutionMap.affected_modules).toBe('session-resume');
  });

  it('resumes implementation routing for generic documentation downgrades', () => {
    const decision = applyActiveImplementationSession(
      'update the docs for that too',
      fixtureClassification({
        workflow: 'documentation-update',
        output_type: 'documentation',
        complexity: 'low',
        risk: 'low',
      }),
      {
        version: 1,
        updated_at: new Date().toISOString(),
        active: true,
        workflow: 'feature-development',
        lane: 'graduated',
        current_phase: 'implementation-review',
        scope: 'single-module',
        affected_modules: ['src/session'],
        changed_files: ['src/session/active-implementation.ts'],
        changed_files_source: 'session-artifact',
        has_code_changes: true,
        pending_verification: true,
        pending_documentation: true,
        unresolved_items: ['Verification blocked'],
      },
    );

    expect(decision.resumed).toBe(true);
    expect(decision.classification.workflow).toBe('feature-development');
    expect(decision.classification.workflow_source).toBe('active-session');
    expect(decision.classification.workflow_continuity_reason).toContain('implementation lane');
  });

  it('does not resume when the user explicitly asks for explanation only', () => {
    const decision = applyActiveImplementationSession(
      'Explain only, do not change code',
      fixtureClassification({
        workflow: 'project-question',
        complexity: 'low',
        risk: 'low',
      }),
      {
        version: 1,
        updated_at: new Date().toISOString(),
        active: true,
        workflow: 'feature-development',
        lane: 'graduated',
        current_phase: 'implementation',
        scope: 'single-module',
        affected_modules: ['src/pipeline'],
        changed_files: ['src/pipeline/classifier.ts'],
        changed_files_source: 'session-artifact',
        has_code_changes: true,
        pending_verification: true,
        pending_documentation: true,
        unresolved_items: [],
      },
    );

    expect(decision.resumed).toBe(false);
    expect(decision.classification.workflow).toBe('project-question');
    expect(decision.classification.workflow_continuity_reason).toContain(
      'explicitly requested explanation-only guidance',
    );
  });

  it('does not annotate continuity when the classification is already implementation work', () => {
    const decision = applyActiveImplementationSession(
      'fix the failing verifier',
      fixtureClassification({
        workflow: 'bug-fix',
        output_type: 'code',
      }),
      {
        version: 1,
        updated_at: new Date().toISOString(),
        active: true,
        workflow: 'feature-development',
        lane: 'graduated',
        current_phase: 'implementation-review',
        scope: 'single-module',
        affected_modules: ['src/pipeline'],
        changed_files: ['src/pipeline/classifier.ts'],
        changed_files_source: 'session-artifact',
        has_code_changes: true,
        pending_verification: true,
        pending_documentation: true,
        unresolved_items: [],
      },
    );

    expect(decision.resumed).toBe(false);
    expect(decision.classification.workflow).toBe('bug-fix');
    expect(decision.classification.workflow_continuity_reason).toBeNull();
  });

  it('keeps the current modules when the resumed session has no scoped module list', () => {
    const resolutionMap: Record<string, string> = {
      workflow: 'deterministic',
      scope: 'default',
      affected_modules: 'default',
    };
    const decision = applyActiveImplementationSession(
      'why',
      fixtureClassification({
        workflow: 'project-question',
        affected_modules: ['src/current-module'],
      }),
      {
        version: 1,
        updated_at: new Date().toISOString(),
        active: true,
        workflow: 'bug-fix',
        lane: 'graduated',
        current_phase: 'implementation-review',
        scope: null,
        affected_modules: [],
        changed_files: ['src/pipeline/classifier.ts'],
        changed_files_source: 'session-artifact',
        has_code_changes: true,
        pending_verification: true,
        pending_documentation: false,
        unresolved_items: [],
      },
      resolutionMap,
    );

    expect(decision.resumed).toBe(true);
    expect(decision.classification.workflow).toBe('bug-fix');
    expect(decision.classification.scope).toBe('system-wide');
    expect(decision.classification.affected_modules).toEqual(['src/current-module']);
    expect(resolutionMap.workflow).toBe('session-resume');
    expect(resolutionMap.scope).toBe('default');
    expect(resolutionMap.affected_modules).toBe('default');
  });

  it('recognizes explicit explanation-only phrasing', () => {
    expect(isExplicitExplanationOnlyIntent('Just explain why this happens')).toBe(true);
    expect(isExplicitExplanationOnlyIntent('please clarify only, no edits')).toBe(true);
    expect(isExplicitExplanationOnlyIntent('how')).toBe(false);
  });

  it('persists and reloads active implementation artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-active-session-'));
    const artifact = createActiveImplementationSession(
      fixtureClassification(),
      'full',
      'implementation',
      [],
      { files: ['src/pipeline/classifier.ts'], source: 'session-artifact' },
    );

    await writeActiveImplementationSession(root, artifact);
    const reloaded = await readActiveImplementationSession(root);

    expect(reloaded).toEqual(artifact);
    expect(readFileSync(join(root, PATHS.ACTIVE_IMPLEMENTATION_SESSION), 'utf8')).toContain(
      '"workflow": "feature-development"',
    );

    rmSync(root, { recursive: true, force: true });
  });

  it('returns null for malformed artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-active-session-'));
    const target = join(root, PATHS.ACTIVE_IMPLEMENTATION_SESSION);
    mkdirSync(join(root, '.paqad', 'session'), { recursive: true });
    writeFileSync(target, '{"version":1,"active":true}', 'utf8');

    await expect(readActiveImplementationSession(root)).resolves.toBeNull();

    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the artifact file contains invalid json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-active-session-'));
    const target = join(root, PATHS.ACTIVE_IMPLEMENTATION_SESSION);
    mkdirSync(join(root, '.paqad', 'session'), { recursive: true });
    writeFileSync(target, '{not-json', 'utf8');

    await expect(readActiveImplementationSession(root)).resolves.toBeNull();

    rmSync(root, { recursive: true, force: true });
  });

  it('returns null when the artifact payload is not an object', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-active-session-'));
    const target = join(root, PATHS.ACTIVE_IMPLEMENTATION_SESSION);
    mkdirSync(join(root, '.paqad', 'session'), { recursive: true });
    writeFileSync(target, '"not-an-object"', 'utf8');

    await expect(readActiveImplementationSession(root)).resolves.toBeNull();

    rmSync(root, { recursive: true, force: true });
  });
});
