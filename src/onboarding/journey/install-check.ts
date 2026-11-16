import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { fixturesRoot, runFixtures, type FixtureResult } from '@/rule-scripts/fixture-runner.js';
import { parseScriptHeader } from '@/rule-scripts/header.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { upsertScriptEntry } from '@/rule-scripts/mutate.js';
import type { ScriptEntry } from '@/rule-scripts/types.js';

import { JourneyRefusal } from './errors.js';
import { normalizeOutputPath } from './paths.js';
import { requireRun } from './run-store.js';

export const STAGED_CHECKS_ROOT = '.paqad/tmp/onboarding/scripts/';
const INSTALLED_ROOT = `${PATHS.RULE_SCRIPTS_DIR}/`;
const KINDS: readonly string[] = ['deterministic', 'heuristic'];
const SCOPES: readonly string[] = ['changed-files', 'whole-tree', 'git-diff', 'git-history'];

export interface InstallCheckInput {
  staged: string;
  ruleId: string;
  kind: string;
  scope: string;
}

export interface InstallCheckResult {
  installed: boolean;
  staged: string;
  path: string;
  fixtures: FixtureResult;
  deferred?: boolean;
  header_errors?: string[];
}

function sameBytes(a: string, b: string): boolean {
  return readFileSync(a).equals(readFileSync(b));
}

function stagedPath(projectRoot: string, raw: string): { staged: string; installed: string } {
  const staged = normalizeOutputPath(projectRoot, raw);
  if (!staged.startsWith(STAGED_CHECKS_ROOT) || !staged.endsWith('.mjs')) {
    throw new JourneyRefusal(
      `Stage the check as a .mjs file under ${STAGED_CHECKS_ROOT}, not ${raw}.`,
    );
  }
  return { staged, installed: `${INSTALLED_ROOT}${staged.slice(STAGED_CHECKS_ROOT.length)}` };
}

export function installStagedCheck(
  projectRoot: string,
  input: InstallCheckInput,
  now: () => Date,
): InstallCheckResult {
  const run = requireRun(projectRoot);
  if (run.status !== 'running' || run.stages.rule_scripts.status !== 'running') {
    throw new JourneyRefusal('Step 7 (Write the rule checks) is not running.');
  }
  if (!KINDS.includes(input.kind)) {
    throw new JourneyRefusal(`Use --kind ${KINDS.join(' or ')}, not ${input.kind}.`);
  }
  if (!SCOPES.includes(input.scope)) {
    throw new JourneyRefusal(`Use --scope ${SCOPES.join(' or ')}, not ${input.scope}.`);
  }
  const { staged, installed } = stagedPath(projectRoot, input.staged);
  const stagedAbs = join(projectRoot, staged);
  if (!existsSync(stagedAbs))
    throw new JourneyRefusal(`The staged check ${staged} does not exist.`);
  const map = loadRuleScriptMap(projectRoot);
  if (map === null) throw new JourneyRefusal('The rule-script map is missing; run step 6 first.');
  if (!map.rules.some((rule) => rule.id === input.ruleId)) {
    throw new JourneyRefusal(`Rule ${input.ruleId} is not in the rule-script map.`);
  }
  const installedAbs = join(projectRoot, installed);
  if (existsSync(installedAbs) && !sameBytes(stagedAbs, installedAbs)) {
    throw new JourneyRefusal(
      `${installed} already exists with other content; onboarding never rewrites an existing check.`,
    );
  }
  const header = parseScriptHeader(readFileSync(stagedAbs, 'utf8'));
  const fixtures = runFixtures(stagedAbs);
  const base = { staged, path: installed, fixtures };
  if ((fixtures.missing_binaries ?? []).length > 0) {
    return { installed: false, deferred: true, ...base };
  }
  if (!header.ok || !fixtures.passed) {
    return { installed: false, header_errors: header.errors, ...base };
  }
  mkdirSync(dirname(installedAbs), { recursive: true });
  cpSync(stagedAbs, installedAbs);
  const stagedFixtures = fixturesRoot(stagedAbs);
  const installedFixtures = fixturesRoot(installedAbs);
  rmSync(installedFixtures, { recursive: true, force: true });
  cpSync(stagedFixtures, installedFixtures, { recursive: true });
  const entry: ScriptEntry = {
    path: installed,
    kind: input.kind as ScriptEntry['kind'],
    runtime: 'node',
    scope: input.scope as ScriptEntry['scope'],
    last_validated_at: now().toISOString(),
    fixtures_passed: true,
  };
  applyRuleScriptMap({
    projectRoot,
    map: upsertScriptEntry(map, input.ruleId, entry),
    via: `rule-script-generator:${input.ruleId}`,
    event: { action: 'generate', rule_ids: [input.ruleId], note: installed },
  });
  return { installed: true, ...base };
}
