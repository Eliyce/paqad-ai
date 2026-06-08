import type {
  AffectsBehaviourVerdict,
  FixChange,
  FixChangedFile,
} from '@/core/types/fix-protocol.js';

/**
 * File extensions whose contents can never change runtime behaviour. A change
 * confined to these files is cosmetic by definition (docs, changelogs).
 */
const NON_BEHAVIOURAL_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst', '.adoc']);

/**
 * Single-line comment markers by file extension. A changed code line that is
 * *only* a comment cannot change behaviour. Anything we don't recognise is
 * treated as behaviour-affecting (the safe default).
 */
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

/**
 * Whether a single changed line is incapable of affecting behaviour for the
 * given file extension: blank lines, full-line comments, and C-style
 * block-comment delimiter lines. A line that contains code before its comment
 * is behaviour-affecting.
 */
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

  // C-style block-comment lines (only meaningful where `//` is the marker).
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
  // A file with no recorded line changes is conservatively behaviour-affecting:
  // we cannot prove the change was cosmetic.
  if (changedLines.length === 0) {
    return false;
  }

  return changedLines.every((line) => lineIsNonBehavioural(line, extension));
}

/**
 * The narrow skip-door classifier. Proof-first is skipped only when a change
 * *genuinely cannot* affect behaviour — comment text, blank lines, or edits
 * confined to documentation files. Anything else, and any uncertainty (unknown
 * file type, code lines, a file with no line detail), defaults to
 * behaviour-affecting (issue #103 Settled decision: when in doubt, treat as
 * behaviour-affecting).
 */
export function affectsBehaviour(change: FixChange): AffectsBehaviourVerdict {
  if (change.files.length === 0) {
    // No files at all is treated as behaviour-affecting: there is nothing to
    // prove is cosmetic, so the safe default applies.
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
