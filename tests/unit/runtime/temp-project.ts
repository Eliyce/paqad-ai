import { rmSync } from 'node:fs';

/**
 * Env that keeps the prompt gate from spawning its background context refresh (issue #649).
 * The refresh trigger is inert when `lean_rules` and `rag_enabled` are both off, so a test
 * that does not exercise the refresh passes this and no detached child ever writes into its
 * temp project. On a loaded CI runner that child (a full `paqad-ai rag refresh-context` CLI)
 * can outlive any retry budget, so removing the writer is the only race-free cleanup.
 */
export const NO_CONTEXT_REFRESH_ENV: NodeJS.ProcessEnv = {
  PAQAD_LEAN_RULES: 'false',
  PAQAD_RAG_ENABLED: 'false',
};

/**
 * Remove a temp project that a test ran the prompt gate in (issue #649). The gate fires a
 * DETACHED context-refresh child that keeps writing into the project after the gate
 * returns, so an immediate recursive delete can race it and throw ENOTEMPTY. One shared
 * retry budget (50 tries, 100 ms apart) waits the child out at every cleanup site; tests
 * that do not need the refresh also pass {@link NO_CONTEXT_REFRESH_ENV} so it never starts.
 */
export function removeTempProject(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
}
