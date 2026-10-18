import { rmSync } from 'node:fs';

/**
 * Remove a temp project that a test ran the prompt gate in (issue #649). The gate fires a
 * DETACHED context-refresh child that keeps writing into the project after the gate
 * returns, so an immediate recursive delete can race it and throw ENOTEMPTY. One shared
 * retry budget (50 tries, 100 ms apart) waits the child out at every cleanup site.
 */
export function removeTempProject(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
}
