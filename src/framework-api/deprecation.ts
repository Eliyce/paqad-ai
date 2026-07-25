// Reading a static deprecation marker off a JSDoc tag set (issue #397).
//
// Split out from the node adapter because it is pure string work: it takes the tags a
// compiler already resolved and normalizes them into the three fields the index stores.
// #398's ecosystem adapters can feed their own tag sets through the same shape.
//
// A `deprecated: false` result means "no static marker was found", never "this API is
// live" — see the coverage limit in the docs.

/** A JSDoc tag, narrowed to what deprecation reading needs. */
export interface JsDocTagLike {
  name: string;
  text?: { text: string }[];
}

/** What a tag set says about deprecation. */
export interface DeprecationVerdict {
  deprecated: boolean;
  message: string | null;
  since: string | null;
  for_removal: boolean;
}

/** Phrasings that mean the symbol is slated for removal, not merely discouraged. */
const REMOVAL_PATTERN =
  /\b(will be removed|removed in|slated for removal|scheduled for removal)\b/i;

/** `since <version>` inside a deprecation message, e.g. "deprecated since 4.2". */
const SINCE_PATTERN = /\bsince\s+v?(\d+(?:\.\d+)*(?:[-.][0-9A-Za-z.]+)?)/i;

function tagText(tag: JsDocTagLike): string {
  return (tag.text ?? []).map((part) => part.text).join('');
}

/**
 * Normalize a symbol's JSDoc tags into a deprecation verdict.
 *
 * `since` is taken from an explicit `@since` tag when one is present, because that is the
 * authored answer; otherwise it falls back to a `since <version>` phrase inside the
 * deprecation text, which is how most packages actually record it.
 */
export function readDeprecation(tags: JsDocTagLike[]): DeprecationVerdict {
  const deprecatedTag = tags.find((tag) => tag.name === 'deprecated');
  if (!deprecatedTag) {
    return { deprecated: false, message: null, since: null, for_removal: false };
  }
  const message = tagText(deprecatedTag).trim();
  const sinceTag = tags.find((tag) => tag.name === 'since');
  const explicitSince = sinceTag ? tagText(sinceTag).trim() : '';
  const inlineSince = SINCE_PATTERN.exec(message)?.[1] ?? null;
  return {
    deprecated: true,
    message: message.length > 0 ? message : null,
    since: explicitSince.length > 0 ? explicitSince : inlineSince,
    for_removal: REMOVAL_PATTERN.test(message),
  };
}
