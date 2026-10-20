import type {
  AffectsBehaviourVerdict,
  FixChange,
  FixChangedFile,
} from '@/core/types/fix-protocol.js';

const NON_BEHAVIOURAL_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);

const LINE_COMMENT_MARKERS: Record<string, string[]> = {
  '.ts': ['//'],
  '.tsx': ['//'],
  '.js': ['//'],
  '.jsx': ['//'],
  '.mjs': ['//'],
  '.cjs': ['//'],
  '.go': ['//'],
  '.java': ['//'],
  '.rs': ['//'],
  '.c': ['//'],
  '.h': ['//'],
  '.cpp': ['//'],
  '.cs': ['//'],
  '.py': ['#'],
  '.rb': ['#'],
  '.sh': ['#'],
  '.yaml': ['#'],
  '.yml': ['#'],
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (dot <= slash) {
    return '';
  }
  return path.slice(dot).toLowerCase();
}

function lineIsNonBehavioural(line: string, extension: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return true;
  }

  const markers = LINE_COMMENT_MARKERS[extension];
  if (markers === undefined) {
    return false;
  }

  if (markers.some((marker) => trimmed.startsWith(marker))) {
    return true;
  }

  if (markers.includes('//')) {
    if (trimmed.startsWith('/*') || trimmed.startsWith('*/') || trimmed.startsWith('*')) {
      return true;
    }
  }

  return false;
}

function fileChangeIsNonBehavioural(file: FixChangedFile): boolean {
  const extension = extensionOf(file.path);
  if (NON_BEHAVIOURAL_EXTENSIONS.has(extension)) {
    return true;
  }

  const changedLines = [...file.added_lines, ...file.removed_lines];
  if (changedLines.length === 0) {
    return false;
  }

  return changedLines.every((line) => lineIsNonBehavioural(line, extension));
}

export function affectsBehaviour(change: FixChange): AffectsBehaviourVerdict {
  if (change.files.length === 0) {
    return {
      affects: true,
      reason: 'No changed files were provided; defaulting to behaviour-affecting.',
      behavioural_evidence: [],
    };
  }

  const behaviouralEvidence: string[] = [];
  for (const file of change.files) {
    if (!fileChangeIsNonBehavioural(file)) {
      const extension = extensionOf(file.path);
      const sample = [...file.added_lines, ...file.removed_lines].find(
        (line) => !lineIsNonBehavioural(line, extension),
      );
      behaviouralEvidence.push(sample ? `${file.path}: ${sample.trim()}` : file.path);
    }
  }

  if (behaviouralEvidence.length === 0) {
    return {
      affects: false,
      reason: 'All changes are comments, blank lines, or documentation; cannot affect behaviour.',
      behavioural_evidence: [],
    };
  }

  return {
    affects: true,
    reason: 'At least one change can affect behaviour.',
    behavioural_evidence: behaviouralEvidence,
  };
}
