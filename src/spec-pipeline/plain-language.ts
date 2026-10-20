export interface PlainLanguageSources {
  terms: string[];
  prompt: string;
  vocabulary?: string[];
}

import type { PipelineQuestion, PlainLanguageResult } from './types.js';

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

const JARGON_PHRASES = ['circuit breaker', 'exponential backoff', 'fail fast', 'race condition'];

const HTTP_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function looksTechnical(token: string): boolean {
  if (/[a-z][A-Z]/.test(token)) return true;
  if (/_/.test(token)) return true;
  if (/[/\\]/.test(token)) return true;
  if (/\.[A-Za-z]{1,4}\b/.test(token)) return true;
  if (/\w\(/.test(token)) return true;
  if (/\d/.test(token) && /[A-Za-z]/.test(token)) return true;
  if (HTTP_VERBS.has(token)) return true;
  if (/^[1-5]\d\d$/.test(token)) return true;
  if (JARGON_TERMS.has(token.toLowerCase())) return true;
  return false;
}

function wordBag(text: string): Set<string> {
  const bag = new Set<string>();
  for (const w of text.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (w.length > 0) bag.add(w);
  }
  return bag;
}

export function checkPlainLanguage(
  question: PipelineQuestion,
  sources: PlainLanguageSources,
): PlainLanguageResult {
  const haystack = [sources.prompt, ...sources.terms, ...(sources.vocabulary ?? [])].join(' ');
  const allowed = wordBag(haystack);
  const allowedLower = haystack.toLowerCase();

  const flagged = new Set<string>();
  const surfaces = [question.business_text, ...question.options];
  const combined = surfaces.join(' ');
  const combinedLower = combined.toLowerCase();

  for (const phrase of JARGON_PHRASES) {
    if (combinedLower.includes(phrase) && !allowedLower.includes(phrase)) {
      flagged.add(phrase);
    }
  }

  for (const surface of surfaces) {
    for (const rawToken of surface.split(/\s+/)) {
      const token = rawToken.replace(/^[^A-Za-z0-9_/\\.()]+|[^A-Za-z0-9_/\\.()]+$/g, '');
      if (token.length === 0) continue;
      if (!looksTechnical(token)) continue;
      if (allowed.has(token.toLowerCase())) continue;
      flagged.add(token);
    }
  }

  const flaggedList = [...flagged];
  return { ok: flaggedList.length === 0, flagged: flaggedList };
}
