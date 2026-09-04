// The plain-language check (issue #512, FR-4.3).
//
// A question the user cannot comfortably answer is the same as one never asked. This
// deterministic check flags any term in a question's `business_text` or `options[]` that is
// a technical term from the model's head rather than the project's own vocabulary. It costs
// zero model tokens.
//
// Primary mechanism (FR-4.2/4.3): a term is fine when it appears in the project's sources —
// the S0 grounding terms or the user's own prompt. A "shipped list of obvious offenders"
// (code identifiers, camelCase/snake_case, file paths, table/column names, HTTP verbs and
// status codes, technology names) is a cheap BACKSTOP: such a token is flagged only when it
// is NOT found in the project sources, so a real project noun that happens to look technical
// (a documented table name, say) is allowed.

/** The project sources a question's wording may legitimately draw from (FR-4.2). */
export interface PlainLanguageSources {
  /** Business/domain terms from the S0 grounding (glossary + doc headings). */
  terms: string[];
  /** The user's own prompt wording. */
  prompt: string;
}

import type { PipelineQuestion, PlainLanguageResult } from './types.js';

/** Shipped backstop: obvious jargon that reads as a mechanism, not an outcome. Lowercase. */
const JARGON_TERMS = new Set<string>([
  'endpoint',
  'backoff',
  'idempotent',
  'idempotency',
  'webhook',
  'mutex',
  'semaphore',
  'cron',
  'regex',
  'middleware',
  'polling',
  'debounce',
  'throttle',
  'websocket',
  'oauth',
  'jwt',
  'csrf',
  'cors',
  'orm',
  'sdk',
  'api',
  'sql',
  'nosql',
  'cache',
  'enum',
  'boolean',
  'null',
  'async',
  'thread',
  'kubernetes',
  'docker',
  'redis',
  'kafka',
]);

/** Multi-word jargon phrases that must be flagged as a unit (mechanism phrasing, FR-4.1). */
const JARGON_PHRASES = ['circuit breaker', 'exponential backoff', 'fail fast', 'race condition'];

const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** True when a token looks technical (the backstop patterns). */
function looksTechnical(token: string): boolean {
  if (/[a-z][A-Z]/.test(token)) return true; // camelCase / PascalCase boundary
  if (/_/.test(token)) return true; // snake_case
  if (/[/\\]/.test(token)) return true; // a path
  if (/\.[A-Za-z]{1,4}\b/.test(token)) return true; // dotted identifier / file extension
  if (/\w\(/.test(token)) return true; // a call `foo(`
  if (/\d/.test(token) && /[A-Za-z]/.test(token)) return true; // mixed alnum id (orders_2024, v2)
  if (HTTP_VERBS.has(token)) return true; // HTTP verb (case-sensitive uppercase)
  if (/^[1-5]\d\d$/.test(token)) return true; // HTTP status code
  if (JARGON_TERMS.has(token.toLowerCase())) return true; // shipped jargon list
  return false;
}

/** Normalize a haystack to a lowercase word bag for membership tests. */
function wordBag(text: string): Set<string> {
  const bag = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (w.length > 0) bag.add(w);
  }
  return bag;
}

/**
 * Run the plain-language check over one question. Returns the flagged terms (empty ⇒ ok).
 * A term is flagged when it looks technical (backstop) AND does not appear in the project
 * sources (grounding terms or the prompt) — i.e. it is jargon the model introduced.
 */
export function checkPlainLanguage(
  question: PipelineQuestion,
  sources: PlainLanguageSources,
): PlainLanguageResult {
  const haystack = [sources.prompt, ...sources.terms].join(' ');
  const allowed = wordBag(haystack);
  const allowedLower = haystack.toLowerCase();

  const flagged = new Set<string>();
  const surfaces = [question.business_text, ...question.options];
  const combined = surfaces.join(' ');
  const combinedLower = combined.toLowerCase();

  // Multi-word jargon phrases first (flagged as a unit unless the project uses them).
  for (const phrase of JARGON_PHRASES) {
    if (combinedLower.includes(phrase) && !allowedLower.includes(phrase)) {
      flagged.add(phrase);
    }
  }

  // Single tokens. Split on whitespace so `foo_bar` / `/api/x` / `GET` survive intact.
  for (const surface of surfaces) {
    for (const rawToken of surface.split(/\s+/)) {
      const token = rawToken.replace(/^[^A-Za-z0-9_/\\.()]+|[^A-Za-z0-9_/\\.()]+$/g, '');
      if (token.length === 0) continue;
      if (!looksTechnical(token)) continue;
      // Allowed when the token (or its lowercased word form) is in the project sources.
      if (allowed.has(token.toLowerCase())) continue;
      flagged.add(token);
    }
  }

  const flaggedList = [...flagged];
  return { ok: flaggedList.length === 0, flagged: flaggedList };
}
