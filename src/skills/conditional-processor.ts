const OPEN_PREFIX = '<!-- if:';
const OPEN_SUFFIX = ' -->';
const CLOSE_TAG = '<!-- endif -->';
const WORD_CHAR = /\w/;

export class ConditionalSectionProcessor {
  process(body: string, frameworks: string[]): string {
    const frameworkSet = new Set(frameworks.map((f) => f.toLowerCase()));
    let output = '';
    let copiedUpTo = 0;
    let searchFrom = 0;

    for (;;) {
      const open = body.indexOf(OPEN_PREFIX, searchFrom);
      if (open === -1) break;
      const nameStart = open + OPEN_PREFIX.length;
      let nameEnd = nameStart;
      while (nameEnd < body.length && WORD_CHAR.test(body[nameEnd]!)) nameEnd += 1;
      if (nameEnd === nameStart || !body.startsWith(OPEN_SUFFIX, nameEnd)) {
        searchFrom = open + 1;
        continue;
      }
      const contentStart = nameEnd + OPEN_SUFFIX.length;
      const close = body.indexOf(CLOSE_TAG, contentStart);
      if (close === -1) break;
      const framework = body.slice(nameStart, nameEnd);
      const content = body.slice(contentStart, close);
      output += body.slice(copiedUpTo, open);
      output += frameworkSet.has(framework.toLowerCase()) ? content : '';
      copiedUpTo = close + CLOSE_TAG.length;
      searchFrom = copiedUpTo;
    }

    return output + body.slice(copiedUpTo);
  }
}
