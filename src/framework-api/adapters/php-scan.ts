export interface PhpMethod {
  name: string;
  doc: string | null;
  attributes: string;
  body: string;
}

export interface PhpClass {
  name: string;
  kind: 'class' | 'interface' | 'type' | 'enum';
  doc: string | null;
  attributes: string;
  methods: PhpMethod[];
  dynamic: boolean;
  documentedMethods: string[];
}

export interface PhpFileScan {
  namespace: string | null;
  classes: PhpClass[];
}

const NAMESPACE_PATTERN = /^[ \t]*namespace[ \t]+([A-Za-z_\\][\w\\]*)[ \t]*[;{]/m;

const DOC_BLOCK = String.raw`\/\*\*(?:(?!\*\/)[\s\S])*\*\/`;

const CLASS_PATTERN = new RegExp(
  `(?:(${DOC_BLOCK})[ \\t\\r\\n]*)?((?:#\\[[^\\n]*\\][ \\t\\r\\n]*)*)(?:final[ \\t]+|abstract[ \\t]+|readonly[ \\t]+)*\\b(class|interface|trait|enum)[ \\t]+(\\w+)`,
  'g',
);

const METHOD_PATTERN = new RegExp(
  `(?:(${DOC_BLOCK})[ \\t\\r\\n]*)?((?:#\\[[^\\n]*\\][ \\t\\r\\n]*)*)(?:(?:public|protected|private|static|final|abstract)[ \\t]+)*function[ \\t]+&?(\\w+)[ \\t]*\\(`,
  'g',
);

const DOCUMENTED_METHOD_PATTERN = /@method[ \t]+(?:static[ \t]+)?(?:[^\s(]+[ \t]+)?(\w+)[ \t]*\(/g;

const DYNAMIC_PATTERN = /\b(?:__call|__callStatic|__get)\b|\bMacroable\b|\bextends[ \t]+Facade\b/;

const KIND_BY_KEYWORD: Record<string, PhpClass['kind']> = {
  class: 'class',
  interface: 'interface',
  trait: 'type',
  enum: 'enum',
};

export function stripDocComment(doc: string): string {
  return doc
    .replace(/^\/\*\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^[ \t]*\*[ \t]?/, '').trimEnd())
    .join('\n')
    .trim();
}

function documentedMethods(doc: string | null): string[] {
  if (doc === null) {
    return [];
  }
  const names = new Set<string>();
  for (const match of doc.matchAll(DOCUMENTED_METHOD_PATTERN)) {
    if (match[1] !== undefined) {
      names.add(match[1]);
    }
  }
  return [...names];
}

function bodyAfter(source: string, from: number): string {
  const open = source.indexOf('{', from);
  const semicolon = source.indexOf(';', from);
  if (open === -1 || (semicolon !== -1 && semicolon < open)) {
    return '';
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open, i + 1);
      }
    }
  }
  return source.slice(open);
}

export function scanPhpFile(source: string): PhpFileScan {
  const namespace = NAMESPACE_PATTERN.exec(source)?.[1] ?? null;
  const classes: { at: number; value: PhpClass }[] = [];
  for (const match of source.matchAll(CLASS_PATTERN)) {
    const keyword = match[3];
    const name = match[4];
    /* v8 ignore next 3 -- both groups are mandatory in CLASS_PATTERN, so a match always carries them; the guard exists so a future pattern edit degrades to skipping a declaration rather than recording an undefined name. */
    if (keyword === undefined || name === undefined || match.index === undefined) {
      continue;
    }
    const doc = match[1] === undefined ? null : stripDocComment(match[1]);
    /* v8 ignore next -- the attribute group always participates, empty string included. */
    const attributes = match[2] ?? '';
    const declarationEnd = match.index + match[0].length;
    const bodyStart = source.indexOf('{', declarationEnd);
    const header = bodyStart === -1 ? '' : source.slice(declarationEnd, bodyStart);
    classes.push({
      at: declarationEnd,
      value: {
        name,
        /* v8 ignore next -- the pattern only matches the four keywords the map holds; the fallback keeps the type total. */
        kind: KIND_BY_KEYWORD[keyword] ?? 'class',
        doc,
        attributes,
        methods: [],
        dynamic:
          DYNAMIC_PATTERN.test(header) || DYNAMIC_PATTERN.test(bodyAfter(source, declarationEnd)),
        documentedMethods: documentedMethods(doc),
      },
    });
  }

  for (const match of source.matchAll(METHOD_PATTERN)) {
    const name = match[3];
    /* v8 ignore next 3 -- the name group is mandatory in METHOD_PATTERN; same defensive contract as the class loop above. */
    if (name === undefined || match.index === undefined) {
      continue;
    }
    const owner = ownerOf(classes, match.index);
    if (owner === null) {
      continue;
    }
    owner.methods.push({
      name,
      doc: match[1] === undefined ? null : stripDocComment(match[1]),
      /* v8 ignore next -- as above: the attribute group is always present. */
      attributes: match[2] ?? '',
      body: bodyAfter(source, match.index + match[0].length),
    });
  }

  return { namespace, classes: classes.map((entry) => entry.value) };
}

const DOC_TAG_PATTERN = /@(deprecated|since)\b[ \t]*([^\n]*)/g;

const DEPRECATED_ATTRIBUTE_PATTERN = /#\[\s*\\?Deprecated\s*(?:\(([\s\S]*?)\))?\s*\]/;

const ATTRIBUTE_MESSAGE_PATTERN = /(?:message\s*:\s*)?['"]([^'"]*)['"]/;
const ATTRIBUTE_SINCE_PATTERN = /since\s*:\s*['"]([^'"]*)['"]/;

const TRIGGER_ERROR_PATTERN = /trigger_error\s*\(\s*['"]([^'"]*)['"][\s\S]{0,80}?E_USER_DEPRECATED/;

export function phpDeprecationTags(declaration: {
  doc: string | null;
  attributes: string;
  body?: string;
}): { name: string; text?: { text: string }[] }[] {
  const attribute = DEPRECATED_ATTRIBUTE_PATTERN.exec(declaration.attributes);
  if (attribute !== null) {
    const args = attribute[1] ?? '';
    const message = ATTRIBUTE_MESSAGE_PATTERN.exec(args)?.[1] ?? '';
    const since = ATTRIBUTE_SINCE_PATTERN.exec(args)?.[1];
    const tags: { name: string; text?: { text: string }[] }[] = [
      { name: 'deprecated', text: [{ text: message }] },
    ];
    if (since !== undefined) {
      tags.push({ name: 'since', text: [{ text: since }] });
    }
    return tags;
  }

  if (declaration.doc !== null) {
    const tags: { name: string; text?: { text: string }[] }[] = [];
    for (const match of declaration.doc.matchAll(DOC_TAG_PATTERN)) {
      const name = match[1];
      /* v8 ignore next -- the tag-name group is mandatory in DOC_TAG_PATTERN. */
      if (name !== undefined) {
        /* v8 ignore next -- the value group always participates, empty string included. */
        tags.push({ name, text: [{ text: (match[2] ?? '').trim() }] });
      }
    }
    if (tags.some((tag) => tag.name === 'deprecated')) {
      return tags;
    }
  }

  const triggered = TRIGGER_ERROR_PATTERN.exec(declaration.body ?? '');
  if (triggered !== null) {
    /* v8 ignore next -- the message group is mandatory in TRIGGER_ERROR_PATTERN. */
    return [{ name: 'deprecated', text: [{ text: triggered[1] ?? '' }] }];
  }
  return [];
}

function ownerOf(classes: { at: number; value: PhpClass }[], offset: number): PhpClass | null {
  let owner: PhpClass | null = null;
  for (const entry of classes) {
    if (entry.at <= offset) {
      owner = entry.value;
      continue;
    }
    break;
  }
  return owner;
}
