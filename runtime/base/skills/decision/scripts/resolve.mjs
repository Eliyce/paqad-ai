#!/usr/bin/env node
// Purpose: Resolve a Decision Pause packet the user has answered — record the
//          chosen option (and any free-text rationale), move the packet from
//          `.paqad/decisions/pending/` to `.paqad/decisions/resolved/`, and stamp
//          `resolved_at`. Rejects any id that is not the collision-free
//          `D-<ULID>` form (issue #272).
// Usage:   node scripts/resolve.mjs <project-root> <id> <chosen> [rationale...]
// Output:  JSON { path } on stdout.
// Exit:    0 on success, 1 on usage/validation error.
import { resolvePendingDecision } from 'paqad-ai';

const [projectRoot, id, chosen, ...rationaleParts] = process.argv.slice(2);
if (!projectRoot || !id || !chosen) {
  process.stdout.write(
    'Usage: node scripts/resolve.mjs <project-root> <id> <chosen> [rationale]\n',
  );
  process.exit(projectRoot && id && chosen ? 0 : 1);
}

try {
  const { path } = resolvePendingDecision(projectRoot, id, chosen, rationaleParts.join(' '));
  process.stdout.write(`${JSON.stringify({ path }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
