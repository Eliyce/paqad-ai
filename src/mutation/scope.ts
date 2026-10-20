import { isDocumentationFile, isTestFile } from '@/pipeline/change-evidence.js';

const MUTABLE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.cs',
  '.java',
  '.kt',
  '.py',
  '.php',
  '.rb',
  '.rs',
  '.go',
];

const EXCLUDED_BASENAMES = ['package.json', 'tsconfig.json'];

function hasMutableExtension(filePath: string): boolean {
  return MUTABLE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

export function scopeMutationTargets(changedFiles: string[]): string[] {
  const scoped = new Set<string>();
  for (const raw of changedFiles) {
    const filePath = raw.replace(/\\/g, '/').trim();
    if (filePath.length === 0) {
      continue;
    }
    if (isTestFile(filePath) || isDocumentationFile(filePath)) {
      continue;
    }
    if (EXCLUDED_BASENAMES.includes(filePath.split('/').at(-1) ?? '')) {
      continue;
    }
    if (!hasMutableExtension(filePath)) {
      continue;
    }
    scoped.add(filePath);
  }
  return [...scoped].sort();
}
