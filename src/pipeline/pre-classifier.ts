import type { ClassificationWorkflow, ResolutionMap } from '@/core/types/classification.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';
import type { PreClassificationResult } from '@/core/types/pre-classification.js';
import { detectDecisionForks } from '@/planning/decision-detector.js';

import { estimateContextBudgetHint } from './context-budget-estimator.js';
import { detectDeltaCandidate } from './delta-detector.js';
import { resolveImpacts } from './impact-resolver.js';
import { ModuleResolver } from './module-resolver.js';
import { matchRuleTriggers } from './rule-trigger-matcher.js';
import { resolveScope } from './scope-resolver.js';

interface WorkflowPattern {
  workflow: ClassificationWorkflow;
  priority: number;
  patterns: string[];
}

const WORKFLOW_PATTERNS: WorkflowPattern[] = [
  { workflow: 'pentest-retest', priority: 250, patterns: ['pentest retest', 'pentest-retest'] },
  {
    workflow: 'pentest',
    priority: 240,
    patterns: [
      'pentest',
      'pen test',
      'penetration test',
      'security audit',
      'security review',
      'security test',
      'security scan',
      'vulnerability scan',
      'for vulnerabilities',
    ],
  },
  {
    workflow: 'design-retest',
    priority: 239,
    patterns: ['design retest', 'retest the design'],
  },
  {
    workflow: 'design-test',
    priority: 238,
    patterns: [
      'design test',
      'design audit',
      'design system audit',
      'audit the ui',
      'audit our ui',
      'ui audit',
      'against the design system',
    ],
  },
  {
    workflow: 'health-retest',
    priority: 245,
    patterns: ['health retest', 'health-retest', 'codebase health retest'],
  },
  {
    workflow: 'codebase-health',
    priority: 235,
    patterns: [
      'codebase health',
      'code health',
      'health check',
      'health check-up',
      'health audit',
      "project's health",
      'project health',
      'audit my codebase',
      'audit the codebase',
      'find dead code',
      'check for unused',
      'cleanup audit',
    ],
  },
  {
    workflow: 'site-map-retest',
    priority: 233,
    patterns: ['site map retest', 'site-map retest', 'retest the site map', 'retest site map'],
  },
  {
    workflow: 'site-map',
    priority: 232,
    patterns: [
      'site map',
      'create sitemap',
      'update sitemap',
      'generate sitemap',
      'journey map',
      'map the app',
      'map this app',
      'map our app',
      'map the surfaces',
      'navigation and journeys',
    ],
  },
  {
    workflow: 'rules-generate',
    priority: 229,
    patterns: ['rules generate', 'generate rule scripts', 'generate the rule scripts'],
  },
  {
    workflow: 'rules-analyze',
    priority: 228,
    patterns: [
      'rules analyze',
      'rules analyse',
      'analyze the rules',
      'analyse the rules',
      'analyze our rules',
      'analyse our rules',
      'rules can become scripts',
      'rules could become scripts',
      'rules into scripts',
    ],
  },
  { workflow: 'root-cause-analysis', priority: 230, patterns: ['root cause', 'rca'] },
  {
    workflow: 'module-documentation',
    priority: 225,
    patterns: ['module documentation', 'module docs', 'per module docs'],
  },
  {
    workflow: 'documentation-update',
    priority: 200,
    patterns: ['documentation', 'docs', 'documenation'],
  },
  {
    workflow: 'discovery',
    priority: 190,
    patterns: [
      'rough idea',
      'half baked idea',
      'help me shape',
      'shape this idea',
      'shape the idea',
      'shape an idea',
      'shape my idea',
      'not sure what it should look like',
    ],
  },
  { workflow: 'research', priority: 180, patterns: ['research', 'investigate'] },
];

const CODE_CHANGE_PATTERNS: WorkflowPattern[] = [
  { workflow: 'cleanup', priority: 170, patterns: ['cleanup', 'clean up'] },
  {
    workflow: 'refactor',
    priority: 150,
    patterns: ['refactor', 'refactors', 'refactoring', 'refactored'],
  },
  {
    workflow: 'bug-fix',
    priority: 160,
    patterns: ['fix', 'fixes', 'fixing', 'fixed', 'bug', 'bugs'],
  },
  {
    workflow: 'feature-development',
    priority: 140,
    patterns: [
      'implement',
      'implements',
      'implementing',
      'implemented',
      'build',
      'builds',
      'building',
      'built',
      'add',
      'adds',
      'adding',
      'added',
      'feature',
      'features',
      'develop',
      'develops',
      'developing',
      'developed',
    ],
  },
];

export interface PreClassifierInput {
  request: string;
  profile?: Pick<ProjectProfile, 'intelligence' | 'stack_profile'>;
  resolved_workflow?: {
    workflow: ClassificationWorkflow | null;
  };
  projectRoot?: string;
}

export class PreClassifier {
  constructor(private readonly projectRoot: string = process.cwd()) {}

  async classify(input: PreClassifierInput): Promise<PreClassificationResult> {
    const resolutionMap: ResolutionMap = {};
    const unresolved = new Set<string>();
    const evidence: string[] = [];
    const detectedForks = detectDecisionForks(input.request);
    const workflow = resolveWorkflow(input.request, input.resolved_workflow?.workflow ?? null);
    if (workflow !== undefined) {
      resolutionMap.workflow = 'deterministic';
      evidence.push(`workflow:${workflow}`);
    } else {
      unresolved.add('workflow');
    }

    const moduleResolver = new ModuleResolver(this.projectRoot, input.profile);
    const modulesPromise = moduleResolver.resolve(input.request);

    const result = await withTimeout(
      (async () => {
        const modules = await modulesPromise;
        const modulePaths = modules.modules.map((entry) => entry.path);
        if (modulePaths.length > 0) {
          resolutionMap.affected_modules =
            modules.source === 'rag' ? 'deterministic:rag' : 'deterministic';
          evidence.push(`modules:${modules.source}`);
        } else {
          unresolved.add('affected_modules');
        }

        const [scope, impacts, delta, ruleTriggers] = await Promise.all([
          resolveScope(this.projectRoot, modulePaths).catch(() => {
            unresolved.add('scope');
            return { scope: 'single-module' as const, scope_graph_depth: 0 };
          }),
          Promise.resolve(resolveImpacts({ requestText: input.request, modulePaths })),
          detectDeltaCandidate(this.projectRoot, modulePaths).catch(() => {
            unresolved.add('delta_candidate');
            return {
              delta_candidate: false,
              base_manifest_slug: null,
              prior_requirement_count: null,
              prior_criterion_count: null,
            };
          }),
          matchRuleTriggers(this.projectRoot, modulePaths).catch(() => {
            unresolved.add('matched_rule_triggers');
            return [];
          }),
        ]);

        resolutionMap.scope = unresolved.has('scope') ? 'default' : 'deterministic:graph';
        resolutionMap.database_impact = impacts.resolution_sources.database_impact;
        resolutionMap.api_impact = impacts.resolution_sources.api_impact;
        resolutionMap.ui_impact = impacts.resolution_sources.ui_impact;
        resolutionMap.compliance_sensitivity = impacts.resolution_sources.compliance_sensitivity;
        resolutionMap.customer_facing_impact = impacts.resolution_sources.customer_facing_impact;
        resolutionMap.reversibility = impacts.resolution_sources.reversibility;
        resolutionMap.data_sensitivity = impacts.resolution_sources.data_sensitivity;
        resolutionMap.delta_candidate = delta.delta_candidate
          ? 'deterministic:manifest'
          : 'default';
        resolutionMap.context_budget_hint = 'deterministic';
        resolutionMap.matched_rule_triggers = ruleTriggers.length > 0 ? 'deterministic' : 'default';

        const normalizedScope =
          modules.source === 'stack-heuristic' && scope.scope === 'single-file'
            ? 'single-module'
            : scope.scope;
        const contextBudgetHint = estimateContextBudgetHint({
          scope: normalizedScope,
          delta_candidate: delta.delta_candidate,
          workflow: workflow ?? null,
        });

        return {
          resolved: {
            workflow: workflow ?? undefined,
            affected_modules: modulePaths,
            affected_modules_source: modules.source,
            scope: normalizedScope,
            scope_graph_depth: scope.scope_graph_depth,
            database_impact: impacts.database_impact,
            api_impact: impacts.api_impact,
            ui_impact: impacts.ui_impact,
            compliance_sensitivity: impacts.compliance_sensitivity,
            customer_facing_impact: impacts.customer_facing_impact,
            reversibility: impacts.reversibility,
            data_sensitivity: impacts.data_sensitivity,
            delta_candidate: delta.delta_candidate,
            base_manifest_slug: delta.base_manifest_slug,
            prior_requirement_count: delta.prior_requirement_count,
            prior_criterion_count: delta.prior_criterion_count,
            context_budget_hint: contextBudgetHint,
            matched_rule_triggers: ruleTriggers,
            decision_category: detectedForks[0]?.category,
          },
          hints: {},
          unresolved: Array.from(unresolved),
          resolution_map: resolutionMap,
          evidence: [
            ...evidence,
            ...detectedForks.map((fork) => `decision-fork:${fork.category}:${fork.signal}`),
          ],
          detected_forks: detectedForks,
        } satisfies PreClassificationResult;
      })(),
      300,
      {
        resolved: {
          workflow: workflow ?? undefined,
          affected_modules: [],
          affected_modules_source: 'default',
          scope: 'single-module',
          scope_graph_depth: 0,
          database_impact: 'none',
          api_impact: 'none',
          ui_impact: 'none',
          compliance_sensitivity: 'none',
          customer_facing_impact: 'internal',
          reversibility: 'easily-reversible',
          data_sensitivity: 'none',
          delta_candidate: false,
          base_manifest_slug: null,
          prior_requirement_count: null,
          prior_criterion_count: null,
          context_budget_hint: 'minimal',
          matched_rule_triggers: [],
          decision_category: detectedForks[0]?.category,
        },
        hints: {},
        unresolved: [
          'affected_modules',
          'scope',
          'delta_candidate',
          'database_impact',
          'api_impact',
          'ui_impact',
          'matched_rule_triggers',
        ],
        resolution_map: resolutionMap,
        evidence: [
          ...evidence,
          ...detectedForks.map((fork) => `decision-fork:${fork.category}:${fork.signal}`),
          'timeout',
        ],
        detected_forks: detectedForks,
      } satisfies PreClassificationResult,
    );

    return result;
  }
}

function resolveWorkflow(
  requestText: string,
  routedWorkflow: ClassificationWorkflow | null,
): ClassificationWorkflow | undefined {
  if (routedWorkflow !== undefined && routedWorkflow !== null) {
    return routedWorkflow;
  }

  const normalized = normalizeText(requestText);

  const named = highestMatch(WORKFLOW_PATTERNS, (pattern) =>
    normalized.includes(normalizeText(pattern)),
  );
  if (named) {
    return named;
  }

  if (
    isQuestionRoute(requestText) ||
    hasCodeNegation(normalized) ||
    isCreateArtifactAsk(normalized) ||
    isAboutWorkPrompt(requestText)
  ) {
    return 'project-question';
  }

  const codeWords = codeWordText(requestText);
  const codeChange = highestMatch(CODE_CHANGE_PATTERNS, (pattern) =>
    matchesWholeWord(codeWords, pattern),
  );
  if (codeChange) {
    return codeChange;
  }

  if (namesSourcePath(requestText) && usesPathEditVerb(normalized)) {
    return 'feature-development';
  }

  if (hasTrackerVerb(normalized) && !namesCode(requestText)) {
    return 'project-question';
  }

  return undefined;
}

function highestMatch(
  table: readonly WorkflowPattern[],
  matches: (pattern: string) => boolean,
): ClassificationWorkflow | undefined {
  return table
    .flatMap((entry) =>
      entry.patterns
        .filter(matches)
        .map((pattern) => ({ workflow: entry.workflow, priority: entry.priority, pattern })),
    )
    .sort((left, right) => right.priority - left.priority)[0]?.workflow;
}

function matchesWholeWord(normalized: string, pattern: string): boolean {
  return ` ${normalized} `.includes(` ${normalizeText(pattern)} `);
}

const QUESTION_ANYWHERE_LEADS = new Set([
  'how',
  'where',
  'what',
  'whats',
  'why',
  'which',
  'explain',
  'example',
]);

const CODE_VERBS = new Set([
  'fix',
  'fixes',
  'fixing',
  'fixed',
  'add',
  'adds',
  'adding',
  'added',
  'implement',
  'implements',
  'implementing',
  'implemented',
  'build',
  'builds',
  'building',
  'built',
  'refactor',
  'refactors',
  'refactoring',
  'refactored',
  'change',
  'changes',
  'changing',
  'changed',
  'update',
  'updates',
  'updating',
  'updated',
  'remove',
  'removes',
  'removing',
  'removed',
  'rename',
  'renames',
  'renaming',
  'renamed',
  'migrate',
  'migrates',
  'migrating',
  'migrated',
]);

const PATH_EDIT_VERBS = new Set([
  ...CODE_VERBS,
  'make',
  'makes',
  'making',
  'replace',
  'replaces',
  'replacing',
  'move',
  'moves',
  'moving',
  'extract',
  'extracts',
  'extracting',
  'convert',
  'converts',
  'converting',
  'delete',
  'deletes',
  'deleting',
  'rewrite',
  'rewrites',
  'rewriting',
]);

function usesPathEditVerb(normalized: string): boolean {
  return tokensOf(normalized).some((token) => PATH_EDIT_VERBS.has(token));
}

const POLITE_LEAD_INS = ['can you', 'could you', 'would you', 'please', 'let s'];

export function isQuestionRoute(requestText: string): boolean {
  const normalized = normalizeText(requestText);
  const tokens = normalized.length > 0 ? normalized.split(' ') : [];
  const interrogative =
    tokens.some((token) => QUESTION_ANYWHERE_LEADS.has(token)) ||
    normalized.startsWith('in short') ||
    normalized.includes('show me') ||
    /\?\s*$/.test(requestText);
  return interrogative && !isPoliteCodeRequest(normalized);
}

function isPoliteCodeRequest(normalized: string): boolean {
  const tokens = normalized.length > 0 ? normalized.split(' ') : [];
  if (tokens[0] && CODE_VERBS.has(tokens[0])) {
    return true;
  }
  return POLITE_LEAD_INS.some((lead) => {
    const next = normalized.split(`${lead} `)[1]?.split(' ')[0];
    return next !== undefined && CODE_VERBS.has(next);
  });
}

const CODE_NEGATIONS = [
  'no code changes',
  'no code change',
  'no code',
  'do not code',
  'dont code',
  'without changing',
  'not to code',
];

export function hasCodeNegation(normalized: string): boolean {
  return CODE_NEGATIONS.some((phrase) => normalized.includes(normalizeText(phrase)));
}

const CREATE_VERBS = ['create', 'file', 'open', 'write', 'draft'];
const ARTIFACT_NOUNS = ['issue', 'ticket', 'bug report', 'write up'];

const LEADING_CODE_VERBS = new Set([
  'fix',
  'fixes',
  'implement',
  'implements',
  'build',
  'builds',
  'refactor',
  'refactors',
  'add',
  'adds',
]);

export function isCreateArtifactAsk(normalized: string): boolean {
  if (LEADING_CODE_VERBS.has(tokensOf(normalized)[0] ?? '')) {
    return false;
  }
  const hasCreateVerb = CREATE_VERBS.some((verb) => matchesWholeWord(normalized, verb));
  const hasArtifactNoun = ARTIFACT_NOUNS.some((noun) => normalized.includes(normalizeText(noun)));
  if (!hasCreateVerb || !hasArtifactNoun) {
    return false;
  }
  const alsoImplements = /\b(implement|and (?:fix|add|build|change|update))\b/.test(normalized);
  return !alsoImplements;
}

const TRACKER_NOUNS = new Set(['issue', 'issues', 'ticket', 'tickets', 'pr', 'prs']);

const TRACKER_NOUN_PHRASES = ['pull request', 'pull requests'];

const NOUN_OR_VERB_TRACKER_WORDS = new Set(['draft', 'drafts', 'drafted', 'rewrite', 'rewrites']);

const SOFT_WORK_NOUNS = new Set(['report', 'reports', 'research', 'plan', 'plans', 'doc', 'docs']);

const TRACKER_TARGETS = new Set(['github', 'jira', 'linear']);

const TRACKER_VERBS = new Set([
  'post',
  'posts',
  'posted',
  'posting',
  'repost',
  'file',
  'files',
  'filed',
  'filing',
  'link',
  'links',
  'linked',
  'linking',
  'recheck',
  'rechecks',
  'rechecked',
  'rechecking',
  'confirm',
  'confirms',
  'confirmed',
  'confirming',
  'reconfirm',
  'reconfirms',
  'reconfirmed',
  'reconfirming',
]);

const GENERAL_WORK_VERBS = new Set([
  'draft',
  'drafts',
  'drafted',
  'drafting',
  'update',
  'updates',
  'updated',
  'updating',
  'rewrite',
  'rewrites',
  'rewrote',
  'rewritten',
  'rewriting',
  'check',
  'checks',
  'checked',
  'checking',
]);

const VERB_LEADS = new Set([
  'please',
  'pls',
  'and',
  'then',
  'or',
  'to',
  'can',
  'could',
  'would',
  'will',
  'should',
  'also',
  'just',
  'now',
  'let',
  's',
  'll',
  'you',
  'i',
  'we',
  'yes',
  'yeah',
  'yep',
  'ok',
  'okay',
  'sure',
  'great',
  'perfect',
  'alright',
  'thanks',
]);

const ADD_TO_RE = new RegExp(
  String.raw`\b(?:add|adds|added|adding)\b.*\bto (?:(?:the|this|that|a|an|my|our|your) )?(?:` +
    [...TRACKER_NOUN_PHRASES, ...TRACKER_NOUNS, ...NOUN_OR_VERB_TRACKER_WORDS].join('|') +
    String.raw`)\b`,
);

const CODE_SURFACE_NOUNS = new Set([
  'page',
  'pages',
  'screen',
  'button',
  'component',
  'endpoint',
  'api',
  'function',
  'method',
  'class',
  'field',
  'column',
  'form',
  'modal',
  'footer',
  'header',
  'navbar',
  'sidebar',
  'route',
  'query',
  'schema',
  'test',
  'tests',
  'bug',
  'error',
  'crash',
  'feature',
  'export',
  'import',
  'selector',
  'renders',
  'mobile',
  'desktop',
  'css',
  'layout',
]);

const LABEL_PAIR_RE = /\blabel(?:s|ed|led)? [a-z0-9]+/g;

const STRONG_CODE_VERB_RE =
  /\b(?:fix|fixes|fixing|fixed|implement|implements|implementing|implemented|build|builds|building|built|refactor|refactors|refactoring|refactored|develop|develops|developing|developed)\b/;

const SOURCE_PATH_RE =
  /\b(?:src|lib|app|runtime|tests)\/|\.(?:ts|tsx|js|jsx|mjs|cjs|py|php|rb|go|rs|java|kt|swift|cs|vue|svelte|dart)\b/i;

function namesSourcePath(requestText: string): boolean {
  return SOURCE_PATH_RE.test(requestText);
}

function namesCode(requestText: string): boolean {
  const codeWords = codeWordText(requestText);
  if (namesSourcePath(requestText) || STRONG_CODE_VERB_RE.test(codeWords)) {
    return true;
  }
  const withoutLabels = codeWords.replace(LABEL_PAIR_RE, ' ').trim();
  return withoutLabels.split(/\s+/).some((token) => CODE_SURFACE_NOUNS.has(token));
}

function tokensOf(normalized: string): string[] {
  return normalized.length > 0 ? normalized.split(' ') : [];
}

function inVerbPosition(tokens: readonly string[], index: number): boolean {
  return index === 0 || VERB_LEADS.has(String(tokens[index - 1]));
}

function usesVerbFrom(tokens: readonly string[], verbs: ReadonlySet<string>): boolean {
  return tokens.some((token, index) => verbs.has(token) && inVerbPosition(tokens, index));
}

function hasTrackerVerb(normalized: string): boolean {
  return usesVerbFrom(tokensOf(normalized), TRACKER_VERBS) || ADD_TO_RE.test(normalized);
}

function hasTrackerNoun(normalized: string): boolean {
  const tokens = tokensOf(normalized);
  return (
    tokens.some(
      (token, index) =>
        TRACKER_NOUNS.has(token) ||
        (NOUN_OR_VERB_TRACKER_WORDS.has(token) && !inVerbPosition(tokens, index)),
    ) || TRACKER_NOUN_PHRASES.some((phrase) => matchesWholeWord(normalized, phrase))
  );
}

export function isAboutWorkPrompt(requestText: string): boolean {
  const normalized = normalizeText(requestText);
  if (namesCode(requestText)) {
    return false;
  }
  const tokens = tokensOf(normalized);
  const trackerNoun = hasTrackerNoun(normalized);
  const target = tokens.some((token) => TRACKER_TARGETS.has(token));
  const codeWords = codeWordText(requestText);
  const codeKeyword = CODE_CHANGE_PATTERNS.some((entry) =>
    entry.patterns.some((pattern) => matchesWholeWord(codeWords, pattern)),
  );
  if (codeKeyword && !trackerNoun && !target) {
    return false;
  }
  const trackerVerb = hasTrackerVerb(normalized);
  const workVerb = trackerVerb || usesVerbFrom(tokens, GENERAL_WORK_VERBS);
  if (trackerNoun) {
    return workVerb;
  }
  const softNoun = tokens.some((token) => SOFT_WORK_NOUNS.has(token));
  return softNoun && (trackerVerb || (target && workVerb));
}

function codeWordText(requestText: string): string {
  return normalizeText(requestText.toLowerCase().replace(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g, ' '));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
