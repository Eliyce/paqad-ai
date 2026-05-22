import { writeFile } from 'node:fs/promises';

import type { PatternStore } from './pattern-store.js';
import type { PatternFilter } from './types.js';

const STALENESS_THRESHOLD_DAYS = 180;

export class PatternCli {
  constructor(private readonly store: PatternStore) {}

  async list(filter?: PatternFilter): Promise<void> {
    const patterns = await this.store.list(filter);
    if (patterns.length === 0) {
      console.log('No patterns found.');
      return;
    }
    for (const p of patterns) {
      console.log(`[${p.id.slice(0, 8)}] ${p.category} — ${p.problem.slice(0, 80)}`);
      console.log(`  Stack: ${p.stack_filter.frameworks.join(', ')} | Tags: ${p.tags.join(', ')}`);
      console.log(`  Created: ${p.created_at}`);
      console.log('');
    }
  }

  async prune(olderThanDays = STALENESS_THRESHOLD_DAYS): Promise<void> {
    const patterns = await this.store.list();
    let pruned = 0;
    for (const p of patterns) {
      const ageDays = (Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > olderThanDays) {
        await this.store.delete(p.id);
        pruned++;
      }
    }
    console.log(`Pruned ${pruned} pattern(s).`);
  }

  async exportPatterns(outputPath: string, format: 'json' | 'markdown'): Promise<void> {
    const patterns = await this.store.list();

    if (format === 'json') {
      await writeFile(outputPath, JSON.stringify(patterns, null, 2), 'utf8');
    } else {
      const lines: string[] = ['# Pattern Library Export\n'];
      for (const p of patterns) {
        lines.push(`## ${p.category}: ${p.problem.slice(0, 60)}`);
        lines.push(`**ID:** ${p.id}  `);
        lines.push(`**Stack:** ${p.stack_filter.frameworks.join(', ')}  `);
        lines.push(`**Created:** ${p.created_at}\n`);
        lines.push(`### Problem\n${p.problem}\n`);
        lines.push(`### Solution\n${p.solution}\n`);
        lines.push('---\n');
      }
      await writeFile(outputPath, lines.join('\n'), 'utf8');
    }
    console.log(`Exported ${patterns.length} pattern(s) to ${outputPath}`);
  }
}
