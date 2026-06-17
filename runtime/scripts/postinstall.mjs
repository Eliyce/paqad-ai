#!/usr/bin/env node
// Restore the executable bit on the shipped runtime hooks/scripts after install.
//
// Why this exists: paqad-ai is released with `changeset publish`, which packs
// the tarball with pnpm. pnpm's packer normalises every file mode to 0644 and
// drops the executable bit (`npm pack` preserves it; pnpm does not). The host
// agent (Claude Code, etc.) invokes the runtime hooks as bare command paths —
// e.g. `~/.paqad-ai/current/hooks/verification-completion.mjs` — and the OS
// refuses to exec a non-executable file ("permission denied", exit 126). The
// symptom is that NONE of the hooks fire on an installed copy: the agent-entry
// gate, the decision-pause gate, and — most visibly — the Stop hook that runs
// the verification backstop, so the evidence ledger, receipts, AI-BOM and the
// dashboard data are never produced for any onboarded project on that machine.
//
// npm/pnpm run this `postinstall` automatically on install and on update via
// the shell (never by exec'ing a file), so it is itself immune to the stripped
// bit and needs no action from the user. It is idempotent and must never fail
// the install: a chmod error degrades to a warning, never a non-zero exit.

import { chmodSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Files invoked directly as commands by the host agent / git hooks / CI.
const EXECUTABLE_EXTENSIONS = new Set(['.sh', '.mjs']);

// runtime/scripts/postinstall.mjs -> runtime/
const runtimeDir = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGET_DIRS = [join(runtimeDir, 'hooks'), join(runtimeDir, 'scripts')];

function chmodExecutablesIn(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Directory absent (partial install / pruned files): nothing to do.
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      chmodExecutablesIn(full);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.name.slice(dot);
    if (!EXECUTABLE_EXTENSIONS.has(ext)) continue;
    try {
      // Preserve the read bits, add owner/group/other execute -> 0o755.
      const mode = statSync(full).mode & 0o777;
      chmodSync(full, mode | 0o111);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[paqad] could not make ${full} executable: ${message}\n`);
    }
  }
}

try {
  for (const dir of TARGET_DIRS) {
    chmodExecutablesIn(dir);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[paqad] postinstall hook-permission step skipped: ${message}\n`);
}

// Always succeed: a permission step must never wedge an install.
process.exit(0);
