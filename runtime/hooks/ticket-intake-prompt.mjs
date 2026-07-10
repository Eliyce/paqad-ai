#!/usr/bin/env node
// ticket-intake-prompt.mjs — UserPromptSubmit hook (issue #322).
//
// The deterministic prompt seam for ticket intake: when the user's prompt names a
// tracker ticket (Jira `PROJ-123` / GitHub `#123`), emit a `▸ paqad` systemMessage
// arming intake — "detected PQD-123 — run `paqad-ai intake fetch PQD-123`" — so the
// spec grounds in the REAL ticket instead of a guess from the id. Advisory only: it
// never blocks and never fetches (fetch is the explicit CLI verb it names). On hosts
// with no systemMessage-on-prompt seam this hook simply isn't wired.
//
// Best-effort and non-blocking: any error (no dist, no payload, disabled) exits 0
// with no output, so it can never wedge or contaminate a turn.

import process from 'node:process';

import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';

async function main(rawInput) {
  const projectRoot = resolveProjectRoot();
  // Disabled → pure no-op (no stdout), so an OFF A/B arm is never contaminated.
  if (isPaqadDisabled(projectRoot)) return 0;

  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch {
    return 0;
  }
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
  if (!prompt) return 0;

  try {
    const distUrl = new URL('../../dist/planning/ticket-ref-detect.js', import.meta.url);
    const { detectTicketRefs, armIntakeNarration } = await import(distUrl.href);
    // 'generic' matches both Jira- and GitHub-style refs — a project that has not
    // pinned a tracker still gets the nudge; the arming line is advisory either way.
    const refs = detectTicketRefs(prompt, 'generic');
    const line = armIntakeNarration(refs);
    if (line) process.stdout.write(line + '\n');
  } catch {
    // No dist bundle / import failure → no nudge this turn. Never throws.
  }
  return 0;
}

let done = false;
const chunks = [];
const run = () => {
  if (done) return;
  done = true;
  main(Buffer.concat(chunks).toString('utf8'))
    .then((code) => process.exit(code))
    .catch(() => process.exit(0));
};

process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', run);
process.stdin.on('error', run);
process.stdin.resume();
