// Reading a static deprecation marker off a JSDoc tag set (issue #397).
//
// Split out from the node adapter because it is pure string work: it takes the tags a
// compiler already resolved and normalizes them into the three fields the index stores.
// #398's ecosystem adapters can feed their own tag sets through the same shape.
//
// A `deprecated: false` result means "no static marker was found", never "this API is
// live" — see the coverage limit in the docs.

/**
 * A JSDoc tag, narrowed to what deprecation reading needs.
 *
 * `text` arrives as display PARTS, not a string: a `{@link Foo.bar baz}` reference is
 * split across `link` / `linkName` / `linkText` parts, so joining them naively produces
 * the mangled "…componentDidMountcomponentDidMount…" that React's own tag would render as.
 */
export interface JsDocTagLike {
  name: string;
  text?: { text: string; kind?: string }[];
}

/** What a tag set says about deprecation. */
export interface DeprecationVerdict {
  deprecated: boolean;
  message: string | null;
  since: string | null;
  for_removal: boolean;
}

/**
 * Phrasings that mean the symbol is slated for removal, not merely discouraged.
 * "will stop working in" is React's own wording, verified in `@types/react`.
 */
const REMOVAL_PATTERN =
  /\b(will be removed|removed in|will stop working|slated for removal|scheduled for removal)\b/i;

/** `since <version>` inside a deprecation message, e.g. "deprecated since 4.2". */
const SINCE_PATTERN = /\bsince\s+v?(\d+(?:\.\d+)*(?:[-.][0-9A-Za-z.]+)?)/i;

/**
 * A bare leading version, which is how React writes it: `@deprecated 16.3, use … instead`.
 * Anchored so it only reads a version the tag opens with, never one buried in prose.
 */
const LEADING_VERSION_PATTERN = /^v?(\d+(?:\.\d+)+)\b/;

/**
 * Render a tag's display parts to readable text.
 *
 * A `{@link Target label}` reference renders as its label when it has one and its target
 * otherwise, and the `{@link` / `}` delimiters are dropped — so the message reads the way
 * an editor would show it rather than as concatenated internals.
 */
function tagText(tag: JsDocTagLike): string {
  const parts = tag.text ?? [];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === undefined || part.kind === 'link') {
      continue;
    }
    if (part.kind === 'linkName') {
      // A following `linkText` is the author's label for this reference; prefer it.
      const label = parts[i + 1];
      if (label?.kind === 'linkText' && label.text.trim().length > 0) {
        out.push(label.text.trim());
        i += 1;
        continue;
      }
      out.push(part.text.trim());
      continue;
    }
    out.push(part.text);
  }
  return out.join('').replace(/\s+/g, ' ').trim();
}

/**
 * Normalize a symbol's JSDoc tags into a deprecation verdict.
 *
 * `since` is taken from an explicit `@since` tag when one is present, because that is the
 * authored answer; otherwise it falls back to a `since <version>` phrase inside the
 * deprecation text, which is how most packages actually record it.
 */
/** End a quoted tag message with punctuation, so an appended sentence does not run on. */
function terminated(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function readDeprecation(tags: JsDocTagLike[]): DeprecationVerdict {
  const deprecatedTag = tags.find((tag) => tag.name === 'deprecated');
  if (!deprecatedTag) {
    return { deprecated: false, message: null, since: null, for_removal: false };
  }
  const message = tagText(deprecatedTag).trim();
  const sinceTag = tags.find((tag) => tag.name === 'since');
  const explicitSince = sinceTag ? tagText(sinceTag).trim() : '';
  const inlineSince =
    SINCE_PATTERN.exec(message)?.[1] ?? LEADING_VERSION_PATTERN.exec(message)?.[1] ?? null;
  return {
    deprecated: true,
    message: message.length > 0 ? terminated(message) : null,
    since: explicitSince.length > 0 ? explicitSince : inlineSince,
    for_removal: REMOVAL_PATTERN.test(message),
  };
}
