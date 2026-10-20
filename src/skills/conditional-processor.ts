export class ConditionalSectionProcessor {
  process(body: string, frameworks: string[]): string {
    const frameworkSet = new Set(frameworks.map((f) => f.toLowerCase()));

    const pattern = /<!-- if:(\w+) -->([\s\S]*?)<!-- endif -->/g;

    return body.replace(pattern, (_match, framework: string, content: string) => {
      if (frameworkSet.has(framework.toLowerCase())) {
        return content;
      }
      return '';
    });
  }
}
