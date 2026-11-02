import { rmSync } from 'node:fs';

export const NO_CONTEXT_REFRESH_ENV: NodeJS.ProcessEnv = {
  PAQAD_LEAN_RULES: 'false',
  PAQAD_RAG_ENABLED: 'false',
};

export function removeTempProject(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
}

const SETTLE_MS = 2_000;
const SETTLING_CODES = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM']);

export function removeTempProjectAfterBackgroundWork(root: string): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      return;
    } catch (error) {
      if (!SETTLING_CODES.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETTLE_MS);
    }
  }
}
