// Plan reuse declaration + its deterministic compile-time checks (issue #357, Phase A).
//
// A plan could previously say "I'll build a date-formatting helper" while the project
// already had one: nothing forced the plan to answer "did you check what already exists?".
// This module makes that question part of the plan. The `reuse` section records what was
// consulted, what will be reused, and why anything new is justified — and `plan compile`
// refuses to write a plan without it.
//
// Every check here is deterministic and costs zero model tokens: it cross-references the
// two artifacts paqad already produces (the code-knowledge index and the stack snapshot)
// and otherwise only inspects the template's own shape. Nothing calls a model or the
// network. Checks degrade gracefully by design — a missing index or a missing stack
// snapshot downgrades a check to a WARNING, never a false block, so a project that has
// not built an index is never gated on one.
//
// Phase B (does the framework symbol exist, and is it deprecated, at the installed
// version?) needs a real framework-API index and lives in issue #397; Phase C's ecosystem
// adapters are #398. Neither is implemented here — this module only validates the
// DECLARATION plus the cheap cross-checks against already-detected versions.

import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { readStackSnapshotSync } from '@/introspection/cache.js';
import { levenshtein } from '@/module-decisions/schema.js';

/** Where a reuse check was actually performed. */
export type ReuseConsultedSource =
  | 'existing-surface'
  | 'index-query'
  | 'reuse-catalog'
  | 'module-doc'
  | 'grep'
  | 'framework-api'
  | 'framework-docs';

/** The tiered verdict a framework reuse claim carries; Phase B (#397) fills this properly. */
export type ReuseProvenance = 'asserted' | 'unknown-dynamic' | 'doc-derived';

/** What the plan author checked before deciding to build. */
export interface ReuseConsulted {
  source: ReuseConsultedSource;
  query: string;
  /** For `framework-api`/`framework-docs`, which `package@version` was consulted. */
  target?: string;
  hits: number;
}

/**
 * One thing the plan will reuse. A FIRST-PARTY claim names a `symbol` (and usually the
 * `file` it lives in); a FRAMEWORK-NATIVE claim additionally sets `package`, which is what
 * marks it as framework rather than first-party, plus the resolved `version` the claim is
 * made against.
 */
export interface ReuseClaim {
  symbol: string;
  file?: string;
  how: string;
  /** Set ⇒ this is a framework-native claim, not a first-party one. */
  package?: string;
  /** Resolved installed version the framework claim is made against. */
  version?: string;
  provenance?: ReuseProvenance;
}

/** The framework equivalent that was checked before a new construct was justified. */
export interface FrameworkChecked {
  package: string;
  nearest: string;
  verdict: 'reuse' | 'extend' | 'insufficient' | 'absent';
}

/** A new exported construct the plan introduces, and why it has to exist. */
export interface NewConstruct {
  name: string;
  justification: string;
  framework_checked?: FrameworkChecked;
}

/** The plan's reuse declaration: what was checked, what is reused, what is new. */
export interface PlanReuse {
  consulted: ReuseConsulted[];
  reusing: ReuseClaim[];
  new_constructs: NewConstruct[];
}

/**
 * Step phrasings that imply the plan introduces a new exported construct. Kept as ONE
 * exported constant so the list is tunable without touching the check itself (the issue
 * asks for exactly this). Matched case-insensitively against each step's description.
 *
 * Deliberately narrow: it pairs a create verb with a construct noun, so an incidental
 * "add a test" or "create the changeset" does not demand a `new_constructs` entry.
 */
export const CREATE_KEYWORDS: readonly string[] = [
  'add helper',
  'add a helper',
  'add util',
  'add a util',
  'add component',
  'add a component',
  'create helper',
  'create a helper',
  'create util',
  'create a util',
  'create utility',
  'create component',
  'create a component',
  'new helper',
  'new util',
  'new component',
];

/** The expected shape, shown verbatim when the section is missing (AC-1). */
const EXPECTED_SHAPE = `"reuse": {
  "consulted": [{ "source": "index-query", "query": "date formatting", "hits": 2 }],
  "reusing": [{ "symbol": "formatIsoDate", "file": "src/utils/dates.ts", "how": "call as-is" }],
  "new_constructs": [{ "name": "formatRelativeDate", "justification": "no existing helper handles the relative form" }]
}`;

/** The warning emitted when reuse claims cannot be checked against an index (AC-3). */
export const INDEX_ABSENT_WARNING = 'reuse claims unverified: index not built';

/** The warning emitted when a framework claim cannot be checked against a stack snapshot. */
export const SNAPSHOT_ABSENT_WARNING =
  'framework reuse claims unverified: stack snapshot not built';

/** What a reuse validation concluded: blocking `errors` and non-blocking `warnings`. */
export interface ReuseValidation {
  errors: string[];
  warnings: string[];
}

/** A plan step as the validator needs to see it (only the description matters here). */
interface StepLike {
  description?: string;
}

export interface ValidateReuseInput {
  projectRoot: string;
  reuse: unknown;
  steps: StepLike[];
}

/**
 * Validate a plan template's `reuse` section. Returns blocking `errors` (the compile must
 * write nothing) and non-blocking `warnings` (a check that could not be performed).
 *
 * The shape is checked first and short-circuits: once the section is structurally wrong
 * there is nothing meaningful to cross-check, and piling index errors on top of a shape
 * error would bury the actionable message.
 */
export function validateReuseSection(input: ValidateReuseInput): ReuseValidation {
  const shape = validateShape(input.reuse);
  if (shape.errors.length > 0) {
    return shape;
  }
  const reuse = input.reuse as PlanReuse;
  const errors: string[] = [];
  const warnings: string[] = [];

  checkDeclaredConstructs(reuse, input.steps, errors);
  checkFirstPartySymbols(input.projectRoot, reuse, errors, warnings);
  checkFrameworkClaims(input.projectRoot, reuse, errors, warnings);

  return { errors, warnings };
}

/** Structural validation of the section itself (AC-1 and the non-empty `consulted` rule). */
function validateShape(reuse: unknown): ReuseValidation {
  if (reuse === undefined || reuse === null) {
    return {
      errors: [
        `plan template is missing the required "reuse" section — record what you checked before building.\nExpected shape:\n${EXPECTED_SHAPE}`,
      ],
      warnings: [],
    };
  }
  if (typeof reuse !== 'object' || Array.isArray(reuse)) {
    return { errors: ['plan template "reuse" must be an object'], warnings: [] };
  }
  const candidate = reuse as Partial<PlanReuse>;
  const errors: string[] = [];
  if (!Array.isArray(candidate.consulted) || candidate.consulted.length === 0) {
    errors.push(
      'plan template "reuse.consulted" must list at least one thing you checked (run `npx paqad-ai index query <name>` or read the Existing surface section)',
    );
  }
  if (candidate.reusing !== undefined && !Array.isArray(candidate.reusing)) {
    errors.push('plan template "reuse.reusing" must be an array');
  }
  if (candidate.new_constructs !== undefined && !Array.isArray(candidate.new_constructs)) {
    errors.push('plan template "reuse.new_constructs" must be an array');
  }
  return { errors, warnings: [] };
}

/** The create-keyword a description matches, or null. */
function matchedCreateKeyword(description: string): string | null {
  const haystack = description.toLowerCase();
  return CREATE_KEYWORDS.find((keyword) => haystack.includes(keyword)) ?? null;
}

/**
 * The declare-or-justify rule (AC-4): a plan whose steps say it will create a new helper,
 * util, or component, but which declares no new constructs, has skipped the question this
 * whole section exists to force.
 */
function checkDeclaredConstructs(reuse: PlanReuse, steps: StepLike[], errors: string[]): void {
  if ((reuse.new_constructs ?? []).length > 0) {
    return;
  }
  for (const step of steps) {
    const keyword = matchedCreateKeyword(step.description ?? '');
    if (keyword !== null) {
      errors.push(
        `plan step says "${keyword}" but "reuse.new_constructs" is empty — declare the new construct and justify it, or reword the step if nothing new is introduced`,
      );
      return;
    }
  }
}

/**
 * Cross-check first-party reuse claims against the code-knowledge index (AC-2/AC-3). Only
 * claims WITHOUT a `package` are first-party; a framework claim is Phase B's business and
 * is deliberately not looked up here. An absent index is a warning, never a block.
 */
function checkFirstPartySymbols(
  projectRoot: string,
  reuse: PlanReuse,
  errors: string[],
  warnings: string[],
): void {
  const firstParty = (reuse.reusing ?? []).filter((claim) => claim.package === undefined);
  if (firstParty.length === 0) {
    return;
  }
  const index = readCodeKnowledgeIndex(projectRoot);
  if (!index) {
    warnings.push(INDEX_ABSENT_WARNING);
    return;
  }
  const known = index.symbols.map((symbol) => symbol.name);
  const knownSet = new Set(known);
  for (const claim of firstParty) {
    if (knownSet.has(claim.symbol)) {
      continue;
    }
    const nearest = nearestSymbol(claim.symbol, known);
    errors.push(
      nearest === null
        ? `reuse.reusing names "${claim.symbol}", which is not in the code-knowledge index — check the name, or declare it under new_constructs if you are creating it`
        : `reuse.reusing names "${claim.symbol}", which is not in the code-knowledge index — did you mean "${nearest}"?`,
    );
  }
}

/**
 * The closest known symbol within a small edit distance, or null when nothing is close.
 * Reuses the bounded `levenshtein` already exported for module-slug matching rather than
 * adding a second edit-distance implementation. The threshold scales with the name's
 * length so a short name cannot match an unrelated short name, and a null result is
 * deliberate: suggesting a wildly unrelated symbol is worse than suggesting nothing.
 */
function nearestSymbol(symbol: string, known: string[]): string | null {
  const bound = Math.max(2, Math.floor(symbol.length / 4));
  let best: string | null = null;
  let bestDistance = bound + 1;
  for (const candidate of known) {
    const distance = levenshtein(symbol, candidate, bound);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Phase-A framework checks (AC-8/AC-9/AC-10). Two rules, both cross-checking detection
 * paqad ALREADY performs — no new index:
 *
 *   1. A framework-native reuse claim (one with `package`) must set `version`, and that
 *      `package@version` must match a dependency in the stack snapshot.
 *   2. When a framework is detected, a new construct must show the framework was checked.
 *
 * No framework detected ⇒ rule 2 does not apply and the compile is unchanged (AC-10), so a
 * framework-less project carries no new burden.
 */
function checkFrameworkClaims(
  projectRoot: string,
  reuse: PlanReuse,
  errors: string[],
  warnings: string[],
): void {
  const frameworkClaims = (reuse.reusing ?? []).filter((claim) => claim.package !== undefined);
  if (frameworkClaims.length > 0) {
    checkFrameworkVersions(projectRoot, frameworkClaims, errors, warnings);
  }

  const frameworks = detectedFrameworks(projectRoot);
  if (frameworks.length === 0) {
    return;
  }
  for (const construct of reuse.new_constructs ?? []) {
    if (construct.framework_checked !== undefined) {
      continue;
    }
    if (justificationNamesFramework(construct.justification, frameworks)) {
      continue;
    }
    errors.push(
      `reuse.new_constructs "${construct.name}" must record the framework check — this project uses ${frameworks.join(', ')}. Add "framework_checked", or justify why no ${frameworks[0]} equivalent fits.`,
    );
  }
}

/** Rule 1: a framework claim's `version` must agree with the resolved stack snapshot. */
function checkFrameworkVersions(
  projectRoot: string,
  claims: ReuseClaim[],
  errors: string[],
  warnings: string[],
): void {
  for (const claim of claims) {
    if (!claim.version) {
      errors.push(
        `reuse.reusing "${claim.symbol}" names package "${claim.package}" but sets no "version" — a framework claim must say which installed version it is made against`,
      );
    }
  }
  const versioned = claims.filter((claim) => Boolean(claim.version));
  if (versioned.length === 0) {
    return;
  }
  const snapshot = readStackSnapshotSync(projectRoot);
  if (!snapshot) {
    warnings.push(SNAPSHOT_ABSENT_WARNING);
    return;
  }
  for (const claim of versioned) {
    const installed = snapshot.packages.find((pkg) => pkg.name === claim.package);
    if (!installed) {
      errors.push(
        `reuse.reusing "${claim.symbol}" names package "${claim.package}", which is not in the stack snapshot — check the package name`,
      );
      continue;
    }
    if (installed.locked_version !== claim.version) {
      errors.push(
        `reuse.reusing "${claim.symbol}" claims ${claim.package}@${claim.version}; stack has ${installed.locked_version}`,
      );
    }
  }
}

/** The frameworks detected in the project profile, or `[]` when none / no profile. */
function detectedFrameworks(projectRoot: string): string[] {
  const profile = readProjectProfile(projectRoot);
  const frameworks = profile?.stack_profile?.frameworks;
  return Array.isArray(frameworks) ? frameworks : [];
}

/** Whether a free-text justification already names one of the detected frameworks. */
function justificationNamesFramework(justification: string, frameworks: string[]): boolean {
  const haystack = justification.toLowerCase();
  return frameworks.some((framework) => haystack.includes(framework.toLowerCase()));
}

/** Reuse counts for the end-of-change receipt's planning line (AC-5). */
export interface ReuseCounts {
  reused: number;
  newJustified: number;
}

/**
 * The reuse counts a stored plan declared, or null when it declared none. Tolerant by
 * design: an old `plan.json` written before this change carries no `reuse` section, and
 * the receipt must render exactly as it did before for those (INV-3).
 */
export function reuseCounts(plan: { reuse?: PlanReuse } | null): ReuseCounts | null {
  const reuse = plan?.reuse;
  if (!reuse) {
    return null;
  }
  return {
    reused: (reuse.reusing ?? []).length,
    newJustified: (reuse.new_constructs ?? []).length,
  };
}
