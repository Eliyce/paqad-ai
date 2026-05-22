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
  const hasGwt = /Given[\s\S]*When[\s\S]*Then/m.test(markdown);
  const hasShall = /\bshall\b/i.test(markdown);

  if (hasGwt || hasShall) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: ['Acceptance criteria must use Given/When/Then or shall statements'],
  };
}
