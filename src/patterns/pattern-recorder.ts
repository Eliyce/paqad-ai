import { randomUUID } from 'node:crypto';

import type { Pattern } from './types.js';
import type { PatternStore } from './pattern-store.js';

export interface RecordPatternInput {
  classification: { workflow?: string; description?: string; category?: string };
  projectDirName: string;
  domain: string;
  frameworks: string[];
  traits: string[];
  filesInvolved: string[];
  problem: string;
  solution: string;
  tags?: string[];
  verification: { tests_passed: boolean; build_passed: boolean };
}

export class PatternRecorder {
  constructor(private readonly store: PatternStore) {}

  async record(input: RecordPatternInput): Promise<Pattern> {
    const pattern: Pattern = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      source_project: input.projectDirName,
      stack_filter: {
        domain: input.domain,
        frameworks: input.frameworks,
        traits: input.traits,
      },
      category: input.classification.category ?? input.classification.workflow ?? 'general',
      problem: input.problem,
      solution: input.solution,
      files_involved: input.filesInvolved,
      verification: input.verification,
      tags: input.tags ?? [],
    };

    await this.store.save(pattern);
    return pattern;
  }
}
