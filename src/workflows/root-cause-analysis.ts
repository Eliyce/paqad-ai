import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import type { ClassificationResult } from '@/core/types/classification.js';

export interface RootCauseAnalysisWorkflowOptions {
  projectRoot: string;
  classification: ClassificationResult;
}

export interface RootCauseAnalysisWorkflowResult {
  output_path: string;
  title: string;
}

const DEFAULT_TITLE_SLUG = 'root-cause-analysis';
const RCA_SECTIONS = [
  'Summary',
  'Problem Statement',
  'Impact',
  'Symptoms',
  'Timeline',
  'Root Cause',
  'Contributing Factors',
  'Evidence',
  'Solution',
  'Verification',
  'Follow-Up Actions',
] as const;

export class RootCauseAnalysisWorkflow {
  async run(options: RootCauseAnalysisWorkflowOptions): Promise<RootCauseAnalysisWorkflowResult> {
    const title = deriveTitle(options.classification.request_text);
    const filename = `${toLocalTimestamp(new Date())}-${slugify(title) || DEFAULT_TITLE_SLUG}.md`;
    const relativePath = join(PATHS.RCA_DIR, filename);
    const outputPath = join(options.projectRoot, relativePath);

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, buildRcaDocument(title, options.classification));

    return {
      // POSIX-normalize the user-facing output_path; on Windows path.join
      // would produce backslashes.
      output_path: toPosixPath(relativePath),
      title,
    };
  }
}

function deriveTitle(requestText: string): string {
  const trimmed = requestText.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return 'Root Cause Analysis';
  }

  return trimmed.length > 120 ? `${trimmed.slice(0, 117).trim()}...` : trimmed;
}

function buildRcaDocument(title: string, classification: ClassificationResult): string {
  const lines = [`# ${title}`, ''];

  for (const section of RCA_SECTIONS) {
    lines.push(`## ${section}`);

    if (section === 'Problem Statement') {
      lines.push(classification.request_text);
    } else if (section === 'Summary') {
      lines.push(
        `Workflow: ${classification.workflow}. Stack context: ${classification.domain}/${classification.stack}.`,
      );
    } else if (section === 'Solution') {
      lines.push('Proposed or confirmed remediation goes here.');
    } else {
      lines.push('Pending analysis.');
    }

    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function toLocalTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
