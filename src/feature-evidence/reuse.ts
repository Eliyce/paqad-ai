import { readCodeKnowledgeIndex } from '@/code-knowledge/store.js';
import { readProjectProfile } from '@/core/project-profile.js';
import { queryFrameworkApi, type FrameworkApiQueryResult } from '@/framework-api/query.js';
import { readFrameworkApiIndex } from '@/framework-api/store.js';
import { readStackSnapshotSync } from '@/introspection/cache.js';
import { levenshtein } from '@/module-decisions/schema.js';

export type ReuseConsultedSource =
  | 'existing-surface'
  | 'index-query'
  | 'reuse-catalog'
  | 'module-doc'
  | 'grep'
  | 'framework-api'
  | 'framework-docs';

export type ReuseProvenance = 'asserted' | 'unknown-dynamic' | 'doc-derived';

export interface ReuseConsulted {
  source: ReuseConsultedSource;
  query: string;
  target?: string;
  hits: number;
}

export interface ReuseClaim {
  symbol: string;
  file?: string;
  how: string;
  package?: string;
  version?: string;
  provenance?: ReuseProvenance;
}

export interface FrameworkChecked {
  package: string;
  nearest: string;
  verdict: 'reuse' | 'extend' | 'insufficient' | 'absent';
}

export interface NewConstruct {
  name: string;
  justification: string;
  framework_checked?: FrameworkChecked;
}

export interface PlanReuse {
  consulted: ReuseConsulted[];
  reusing: ReuseClaim[];
  new_constructs: NewConstruct[];
}

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

const EXPECTED_SHAPE = `"reuse": {
  "consulted": [{ "source": "index-query", "query": "date formatting", "hits": 2 }],
  "reusing": [{ "symbol": "formatIsoDate", "file": "src/utils/dates.ts", "how": "call as-is" }],
  "new_constructs": [{ "name": "formatRelativeDate", "justification": "no existing helper handles the relative form" }]
}`;

export const INDEX_ABSENT_WARNING = 'reuse claims unverified: index not built';

export const SNAPSHOT_ABSENT_WARNING =
  'framework reuse claims unverified: stack snapshot not built';

export const FRAMEWORK_API_INDEX_ABSENT_WARNING =
  'framework reuse claims unverified: framework-api index not built';

export interface ReuseValidation {
  errors: string[];
  warnings: string[];
  provenance: Record<string, ReuseProvenance>;
}

interface StepLike {
  description?: string;
}

export interface ValidateReuseInput {
  projectRoot: string;
  reuse: unknown;
  steps: StepLike[];
}

export function validateReuseSection(input: ValidateReuseInput): ReuseValidation {
  const shape = validateShape(input.reuse);
  if (shape.errors.length > 0) {
    return shape;
  }
  const reuse = input.reuse as PlanReuse;
  const errors: string[] = [];
  const warnings: string[] = [];
  const provenance: Record<string, ReuseProvenance> = {};

  checkDeclaredConstructs(reuse, input.steps, errors);
  checkFirstPartySymbols(input.projectRoot, reuse, errors, warnings);
  checkFrameworkClaims(input.projectRoot, reuse, errors, warnings);
  verifyFrameworkSymbols(input.projectRoot, reuse, errors, warnings, provenance);

  return { errors, warnings, provenance };
}

export function frameworkClaimKey(packageName: string, symbol: string): string {
  return `${packageName}::${symbol}`;
}

function verifyFrameworkSymbols(
  projectRoot: string,
  reuse: PlanReuse,
  errors: string[],
  warnings: string[],
  provenance: Record<string, ReuseProvenance>,
): void {
  const claims = (reuse.reusing ?? []).filter(
    (claim): claim is ReuseClaim & { package: string } => claim.package !== undefined,
  );
  if (claims.length === 0) {
    return;
  }
  const index = readFrameworkApiIndex(projectRoot);
  if (!index) {
    warnings.push(FRAMEWORK_API_INDEX_ABSENT_WARNING);
    return;
  }
  for (const claim of claims) {
    const result = queryFrameworkApi(index, claim.package, claim.symbol, claim.version);
    const key = frameworkClaimKey(claim.package, claim.symbol);
    switch (result.verdict) {
      case 'live':
        provenance[key] = 'asserted';
        break;
      case 'deprecated':
        provenance[key] = 'asserted';
        errors.push(deprecatedMessage(claim, result));
        break;
      case 'absent':
        provenance[key] = 'asserted';
        errors.push(
          `reuse.reusing "${claim.symbol}" does not exist in ${claim.package}@${result.version}` +
            (result.nearest === null ? '' : ` — did you mean "${result.nearest}"?`),
        );
        break;
      case 'unknown-dynamic':
        provenance[key] = 'unknown-dynamic';
        warnings.push(
          `reuse.reusing "${claim.symbol}" is provided dynamically by ${claim.package}@${result.version} — paqad could not verify it statically`,
        );
        break;
      default:
        warnings.push(
          `reuse.reusing "${claim.symbol}" unverified: ${claim.package} is not in the framework-api index`,
        );
    }
  }
}

function deprecatedMessage(
  claim: ReuseClaim & { package: string },
  result: FrameworkApiQueryResult,
): string {
  const detail = result.record?.message ?? 'no reason given';
  const since = result.record?.since === null ? '' : ` (deprecated since ${result.record?.since})`;
  const removal = result.record?.for_removal === true ? ' It is slated for removal.' : '';
  return `reuse.reusing "${claim.symbol}" is deprecated in ${claim.package}@${result.version}${since}: ${detail}${removal}`;
}

function validateShape(reuse: unknown): ReuseValidation {
  if (reuse === undefined || reuse === null) {
    return {
      errors: [
        `plan template is missing the required "reuse" section — record what you checked before building.\nExpected shape:\n${EXPECTED_SHAPE}`,
      ],
      warnings: [],
      provenance: {},
    };
  }
  if (typeof reuse !== 'object' || Array.isArray(reuse)) {
    return {
      errors: ['plan template "reuse" must be an object'],
      warnings: [],
      provenance: {},
    };
  }
  const candidate = reuse as Partial<PlanReuse>;
  const errors: string[] = [];
  if (!Array.isArray(candidate.consulted) || candidate.consulted.length === 0) {
    errors.push(
      'plan template "reuse.consulted" must list at least one thing you checked (run `paqad-ai index query <name>` or read the Existing surface section)',
    );
  }
  if (candidate.reusing !== undefined && !Array.isArray(candidate.reusing)) {
    errors.push('plan template "reuse.reusing" must be an array');
  }
  if (candidate.new_constructs !== undefined && !Array.isArray(candidate.new_constructs)) {
    errors.push('plan template "reuse.new_constructs" must be an array');
  }
  return { errors, warnings: [], provenance: {} };
}

function matchedCreateKeyword(description: string): string | null {
  const haystack = description.toLowerCase();
  return CREATE_KEYWORDS.find((keyword) => haystack.includes(keyword)) ?? null;
}

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

function detectedFrameworks(projectRoot: string): string[] {
  const profile = readProjectProfile(projectRoot);
  const frameworks = profile?.stack_profile?.frameworks;
  return Array.isArray(frameworks) ? frameworks : [];
}

function justificationNamesFramework(justification: string, frameworks: string[]): boolean {
  const haystack = justification.toLowerCase();
  return frameworks.some((framework) => haystack.includes(framework.toLowerCase()));
}

export interface ReuseCounts {
  reused: number;
  newJustified: number;
}

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
