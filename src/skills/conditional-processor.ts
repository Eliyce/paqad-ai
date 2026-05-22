/**
 * Processes skill body content and strips non-matching stack-conditional sections.
 *
 * Directive syntax:
 *   <!-- if:laravel -->...<!-- endif -->
 *   <!-- if:react -->...<!-- endif -->
 *   <!-- if:vue -->...<!-- endif -->
 *   <!-- if:flutter -->...<!-- endif -->
 */
export class ConditionalSectionProcessor {
  process(body: string, frameworks: string[]): string {
    const frameworkSet = new Set(frameworks.map((f) => f.toLowerCase()));

    // Match <!-- if:{framework} -->...<!-- endif --> blocks (including multiline)
    const pattern = /<!-- if:(\w+) -->([\s\S]*?)<!-- endif -->/g;

    return body.replace(pattern, (_match, framework: string, content: string) => {
      if (frameworkSet.has(framework.toLowerCase())) {
        return content;
      }
      return '';
    });
  }
}
