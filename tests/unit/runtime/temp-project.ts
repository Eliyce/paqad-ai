import { rmSync } from 'node:fs';

export const NO_CONTEXT_REFRESH_ENV: NodeJS.ProcessEnv = {
  PAQAD_LEAN_RULES: 'false',
  PAQAD_RAG_ENABLED: 'false',
};

export function removeTempProject(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
}
