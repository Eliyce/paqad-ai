import type { EvalDatasetItem, EvalQueryClass } from './types.js';

export const ALL_QUERY_CLASSES: EvalQueryClass[] = [
  'simple-lexical',
  'vocabulary-mismatch',
  'ambiguous',
  'multi-part',
  'workflow-triggering',
  'negative',
];

export const EVAL_DATASET: EvalDatasetItem[] = [
  // simple-lexical: term in query matches term in document exactly
  {
    id: 'sl-1',
    query_class: 'simple-lexical',
    task_description: 'authorization check failing in the gate',
    keywords: ['authorization'],
    expected_file: 'src/security/auth-gates.ts',
  },
  {
    id: 'sl-2',
    query_class: 'simple-lexical',
    task_description: 'coupon redemption error in billing',
    keywords: ['coupon'],
    expected_file: 'src/billing/coupon-ledger.ts',
  },

  // vocabulary-mismatch: query uses synonyms or paraphrases not in the document
  {
    id: 'vm-1',
    query_class: 'vocabulary-mismatch',
    task_description: 'access control problem for admin users',
    keywords: ['access', 'admin'],
    expected_file: 'src/security/auth-gates.ts',
  },
  {
    id: 'vm-2',
    query_class: 'vocabulary-mismatch',
    task_description: 'email sending failing for registered users',
    keywords: ['email', 'sending'],
    expected_file: 'src/notifications/mailer.ts',
  },

  // ambiguous: query is underspecified and could match multiple modules
  {
    id: 'am-1',
    query_class: 'ambiguous',
    task_description: 'fix the bug in the service layer',
    keywords: ['bug', 'service'],
  },
  {
    id: 'am-2',
    query_class: 'ambiguous',
    task_description: 'improve the overall performance',
    keywords: ['performance'],
  },

  // multi-part: compound task that spans multiple retrieval targets
  {
    id: 'mp-1',
    query_class: 'multi-part',
    task_description: 'fix authorization bug and update the mailer template',
    keywords: ['authorization', 'notification'],
  },
  {
    id: 'mp-2',
    query_class: 'multi-part',
    task_description: 'refactor coupon logic and add background retry worker',
    keywords: ['coupon', 'retry'],
  },

  // workflow-triggering: task that should surface a workflow recommendation
  {
    id: 'wt-1',
    query_class: 'workflow-triggering',
    task_description: 'run a security audit on the authorization module',
    keywords: ['security', 'audit', 'authorization'],
    workflow_trigger: 'pentest',
  },
  {
    id: 'wt-2',
    query_class: 'workflow-triggering',
    task_description: 'investigate the root cause of the payment failure',
    keywords: ['root-cause', 'payment'],
    workflow_trigger: 'root-cause-analysis',
  },

  // negative: retrieval should be skipped or minimized for these tasks
  {
    id: 'ng-1',
    query_class: 'negative',
    task_description: 'rename variable x to itemCount',
    keywords: ['rename'],
    should_skip_retrieval: true,
  },
  {
    id: 'ng-2',
    query_class: 'negative',
    task_description: 'add a comment to explain this line',
    keywords: ['comment'],
    should_skip_retrieval: true,
  },
];

export function getDatasetByClass(queryClass: EvalQueryClass): EvalDatasetItem[] {
  return EVAL_DATASET.filter((item) => item.query_class === queryClass);
}

export function validateDatasetCoverage(): boolean {
  return ALL_QUERY_CLASSES.every((cls) => getDatasetByClass(cls).length > 0);
}
