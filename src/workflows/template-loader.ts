import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import YAML from 'yaml';
import type { WorkflowTemplate } from './types.js';
import { isReservedWorkflowPolicyFile } from '@/pipeline/feature-development-policy.js';

export class WorkflowTemplateLoader {
  constructor(private readonly projectRoot: string) {}

  get workflowsDir(): string {
    return join(this.projectRoot, 'docs', 'instructions', 'workflows');
  }

  async load(workflowName: string): Promise<WorkflowTemplate> {
    const filePath = join(this.workflowsDir, `${workflowName}.yaml`);
    const raw = await readFile(filePath, 'utf8');
    return YAML.parse(raw) as WorkflowTemplate;
  }

  async list(): Promise<string[]> {
    try {
      const files = await readdir(this.workflowsDir);
      return files
        .filter(
          (f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !isReservedWorkflowPolicyFile(f),
        )
        .map((f) => f.replace(/\.(yaml|yml)$/, ''));
    } catch {
      return [];
    }
  }
}
