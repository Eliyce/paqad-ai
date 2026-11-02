import { rmSync } from 'node:fs';

export const NO_CONTEXT_REFRESH_ENV: NodeJS.ProcessEnv = {
  PAQAD_LEAN_RULES: 'false',
  PAQAD_RAG_ENABLED: 'false',
};

export function removeTempProject(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
}

const SETTLE_ROUNDS = 6;
const SETTLE_MS = 2_000;

export function removeTempProjectAfterBackgroundWork(root: string): void {
  for (let round = 1; ; round += 1) {
    try {
      removeTempProject(root);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const settling = code === 'ENOTEMPTY' || code === 'EBUSY' || code === 'EPERM';
      if (!settling || round >= SETTLE_ROUNDS) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETTLE_MS);
    }
  }
}
