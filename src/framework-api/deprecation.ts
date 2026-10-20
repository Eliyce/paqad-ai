export interface JsDocTagLike {
  name: string;
  text?: { text: string; kind?: string }[];
}

export interface DeprecationVerdict {
  deprecated: boolean;
  message: string | null;
  since: string | null;
  for_removal: boolean;
}

const REMOVAL_PATTERN =
  /\b(will be removed|removed in|will stop working|slated for removal|scheduled for removal)\b/i;

const SINCE_PATTERN = /\bsince\s+v?(\d+(?:\.\d+)*(?:[-.][0-9A-Za-z.]+)?)/i;

const LEADING_VERSION_PATTERN = /^v?(\d+(?:\.\d+)+)\b/;

function tagText(tag: JsDocTagLike): string {
  const parts = tag.text ?? [];
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part === undefined || part.kind === 'link') {
      continue;
    }
    if (part.kind === 'linkName') {
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
