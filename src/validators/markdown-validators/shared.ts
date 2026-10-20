export interface MarkdownValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateRequiredHeadings(
  markdown: string,
  headings: string[],
): MarkdownValidationResult {
  const errors = headings
    .filter((heading) => !markdown.includes(heading))
    .map((heading) => `Missing required heading: ${heading}`);

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateAcStatements(markdown: string): MarkdownValidationResult {
  const hasGwt = containsInOrder(markdown, ['Given', 'When', 'Then']);
  const hasShall = /\bshall\b/i.test(markdown);

  if (hasGwt || hasShall) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: ['Acceptance criteria must use Given/When/Then or shall statements'],
  };
}

export function containsInOrder(text: string, words: string[]): boolean {
  let from = 0;
  for (const word of words) {
    const at = text.indexOf(word, from);
    if (at === -1) return false;
    from = at + word.length;
  }
  return true;
}
