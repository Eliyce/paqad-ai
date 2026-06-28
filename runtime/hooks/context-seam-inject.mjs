#!/usr/bin/env node
// context-seam-inject.mjs — UserPromptSubmit-seam CLI wrapper (RAG buildout F2).
//
// The emit logic lives in lib/context-seam-emit.mjs so the agent-entry prompt gate
// can reuse it in-process (no child spawn) while controlling ordering — the
// always-load directive must precede any context block, never be buried under it.
// This thin wrapper keeps the standalone hook entry working: it reads the host's
// stdin prompt payload (for the session id) then emits.
//
// Guarantees (FEATURES.md hard constraints): read-only + budgeted, and it ALWAYS
// exits 0 and swallows every error — a missing artifact, a disabled project, or
// any failure emits nothing and the agent proceeds with grep/read as today (F3).

import process from 'node:process';

import { emitContext } from './lib/context-seam-emit.mjs';

let done = false;
const chunks = [];
const run = () => {
  if (done) return;
  done = true;
  emitContext(Buffer.concat(chunks).toString('utf8'));
};

process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', run);
process.stdin.on('error', run);
process.stdin.resume();
