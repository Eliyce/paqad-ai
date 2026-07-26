// Reading PHP declarations out of installed vendor source (issue #398).
//
// Split from the adapter because it is pure string work over one file's text: the adapter
// decides WHICH files to read and what to record; this decides what a file declares.
//
// nikic/PHP-Parser is the tool the research note names, and it is a COMPOSER package — it
// needs a PHP runtime paqad-ai cannot assume, in a Node CLI whose only optional peer is
// `typescript` (#397 kept it optional precisely so an any-stack install pays no toolchain
// tax). So the declaration layer is read here instead, and the read is deliberately shaped
// so its limits can never produce a false "absent": the adapter asserts existence only for
// the class declarations this scan enumerates in full, and every class also emits a
// wildcard, so any member this scan misses reads `unknown-dynamic` (INV-1).

/** One method declared on a class, with the deprecation evidence attached to it. */
export interface PhpMethod {
  name: string;
  /** The docblock immediately above the declaration, without its comment delimiters. */
  doc: string | null;
  /** The `#[...]` attribute list immediately above the declaration, raw. */
  attributes: string;
  /** The method body's text, used only to spot a `trigger_error(…, E_USER_DEPRECATED)`. */
  body: string;
}

/** One class-like declaration (class, interface, trait or enum) and what it declares. */
export interface PhpClass {
  name: string;
  kind: 'class' | 'interface' | 'type' | 'enum';
  doc: string | null;
  attributes: string;
  methods: PhpMethod[];
  /**
   * Whether members can appear at runtime: a `Macroable`, a `__call` / `__callStatic` /
   * `__get` magic method, or a facade. Every class gets a wildcard anyway — this flag
   * exists so the adapter can say WHY in the docs, not to gate the wildcard.
   */
  dynamic: boolean;
  /** Method names promised by the class docblock's `@method static …` lines (facades). */
  documentedMethods: string[];
}

export interface PhpFileScan {
  namespace: string | null;
  classes: PhpClass[];
}

/** `namespace Foo\Bar;` or `namespace Foo\Bar {`. */
const NAMESPACE_PATTERN = /^[ \t]*namespace[ \t]+([A-Za-z_\\][\w\\]*)[ \t]*[;{]/m;

/**
 * One docblock, which must NOT swallow a later one.
 *
 * `[\s\S]*?` alone can expand across an intervening comment and attach a class's docblock
 * to a method three lines below it — which then anchors the whole match ABOVE the class
 * declaration, and the method is attributed to no class at all. Forbidding an inner `*​/`
 * keeps a docblock bound to the declaration it actually sits on.
 */
const DOC_BLOCK = String.raw`\/\*\*(?:(?!\*\/)[\s\S])*\*\/`;

/** A class-like declaration, with any docblock and attribute list that precedes it. */
const CLASS_PATTERN = new RegExp(
  `(?:(${DOC_BLOCK})[ \\t\\r\\n]*)?((?:#\\[[^\\n]*\\][ \\t\\r\\n]*)*)(?:final[ \\t]+|abstract[ \\t]+|readonly[ \\t]+)*\\b(class|interface|trait|enum)[ \\t]+(\\w+)`,
  'g',
);

/** A method declaration, with any docblock and attribute list that precedes it. */
const METHOD_PATTERN = new RegExp(
  `(?:(${DOC_BLOCK})[ \\t\\r\\n]*)?((?:#\\[[^\\n]*\\][ \\t\\r\\n]*)*)(?:(?:public|protected|private|static|final|abstract)[ \\t]+)*function[ \\t]+&?(\\w+)[ \\t]*\\(`,
  'g',
);

/** A `@method static <type> name(…)` promise in a facade's class docblock. */
const DOCUMENTED_METHOD_PATTERN = /@method[ \t]+(?:static[ \t]+)?(?:[^\s(]+[ \t]+)?(\w+)[ \t]*\(/g;

/** The magic and macro signals that make a class's member set open-ended. */
const DYNAMIC_PATTERN = /\b(?:__call|__callStatic|__get)\b|\bMacroable\b|\bextends[ \t]+Facade\b/;

/** Which normalized kind a PHP declaration keyword maps to. */
const KIND_BY_KEYWORD: Record<string, PhpClass['kind']> = {
  class: 'class',
  interface: 'interface',
  trait: 'type',
  enum: 'enum',
};

/** Strip a docblock's `/**`, `*` and `*​/` decoration, keeping the text and its tags. */
export function stripDocComment(doc: string): string {
  return doc
    .replace(/^\/\*\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^[ \t]*\*[ \t]?/, '').trimEnd())
    .join('\n')
    .trim();
}

/** Every method name a class docblock promises through `@method` (Laravel's facades). */
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

/**
 * Where a declaration's body ends, by counting braces from its opening one. Returns the
 * whole remainder when the braces never balance, which is the conservative answer: a body
 * read too long can only ADD deprecation evidence, never remove a declaration.
 */
function bodyAfter(source: string, from: number): string {
  const open = source.indexOf('{', from);
  const semicolon = source.indexOf(';', from);
  // An abstract or interface method ends at `;` with no body at all.
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

/**
 * Scan one PHP file's declarations.
 *
 * Methods are attributed to the last class declared before them, which is exactly right for
 * the PSR-4 one-class-per-file layout every framework this index targets follows. A nested
 * or anonymous class would attribute its methods to the enclosing class — that can only add
 * member records to a container that already carries a wildcard, so the worst case is a
 * harmless extra record, never a false absence.
 */
export function scanPhpFile(source: string): PhpFileScan {
  const namespace = NAMESPACE_PATTERN.exec(source)?.[1] ?? null;
  const classes: { at: number; value: PhpClass }[] = [];
  for (const match of source.matchAll(CLASS_PATTERN)) {
    const keyword = match[3];
    const name = match[4];
    if (keyword === undefined || name === undefined || match.index === undefined) {
      continue;
    }
    const doc = match[1] === undefined ? null : stripDocComment(match[1]);
    const attributes = match[2] ?? '';
    const declarationEnd = match.index + match[0].length;
    // The header (`extends Facade`, `implements …`) sits between the class name and the
    // body's opening brace, so a facade is only visible when both are read.
    const bodyStart = source.indexOf('{', declarationEnd);
    const header = bodyStart === -1 ? '' : source.slice(declarationEnd, bodyStart);
    classes.push({
      at: declarationEnd,
      value: {
        name,
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
      attributes: match[2] ?? '',
      body: bodyAfter(source, match.index + match[0].length),
    });
  }

  return { namespace, classes: classes.map((entry) => entry.value) };
}

/** `@deprecated …` / `@since …` in a docblock, up to the next tag or blank line. */
const DOC_TAG_PATTERN = /@(deprecated|since)\b[ \t]*([^\n]*)/g;

/** `#[\Deprecated]`, with or without arguments, in an attribute list. */
const DEPRECATED_ATTRIBUTE_PATTERN = /#\[\s*\\?Deprecated\s*(?:\(([\s\S]*?)\))?\s*\]/;

/** A named or positional string argument of the `#[\Deprecated]` attribute. */
const ATTRIBUTE_MESSAGE_PATTERN = /(?:message\s*:\s*)?['"]([^'"]*)['"]/;
const ATTRIBUTE_SINCE_PATTERN = /since\s*:\s*['"]([^'"]*)['"]/;

/** `trigger_error('…', E_USER_DEPRECATED)` anywhere in a method body. */
const TRIGGER_ERROR_PATTERN =
  /trigger_error\s*\(\s*['"]([^'"]*)['"][\s\S]{0,80}?E_USER_DEPRECATED/;

/**
 * The deprecation tags a PHP declaration carries, in the priority the research note sets:
 * the `#[\Deprecated]` attribute (PHP 8.4+) first, then an `@deprecated` docblock, then a
 * `trigger_error(…, E_USER_DEPRECATED)` in the body.
 *
 * Returned as JSDoc-shaped tags so {@link readDeprecation} normalizes them — the same
 * reader the node adapter uses, rather than a second deprecation reader per ecosystem.
 */
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
      if (name !== undefined) {
        tags.push({ name, text: [{ text: (match[2] ?? '').trim() }] });
      }
    }
    if (tags.some((tag) => tag.name === 'deprecated')) {
      return tags;
    }
  }

  const triggered = TRIGGER_ERROR_PATTERN.exec(declaration.body ?? '');
  if (triggered !== null) {
    return [{ name: 'deprecated', text: [{ text: triggered[1] ?? '' }] }];
  }
  return [];
}

/** The last class declared before `offset`, or null when the offset precedes them all. */
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
