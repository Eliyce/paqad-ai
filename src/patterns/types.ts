export interface Pattern {
  id: string;
  created_at: string;
  source_project: string;
  stack_filter: {
    domain: string;
    frameworks: string[];
    traits: string[];
  };
  category: string;
  problem: string;
  solution: string;
  files_involved: string[];
  verification: {
    tests_passed: boolean;
    build_passed: boolean;
  };
  tags: string[];
}

export interface PatternIndexEntry {
  id: string;
  category: string;
  stack_filter: Pattern['stack_filter'];
  tags: string[];
  created_at: string;
  problem_preview: string; // first 100 chars of problem
}

export interface PatternIndex {
  version: 1;
  entries: PatternIndexEntry[];
}

export interface PatternFilter {
  domain?: string;
  frameworks?: string[];
  keywords?: string[];
  category?: string;
}

export interface PatternMatch {
  pattern: Pattern;
  score: number;
  is_stale: boolean;
}
