# Atomic Artifact Swap — API View

> Module: **Background-Worker Harness** (`background-harness`) · Layer: `framework-internals` · Feature slug: `atomic-artifact-swap`

Internal TypeScript helpers only. No CLI verb and no config key.

## `src/background/atomic-artifact.ts`

```ts
export async function buildAndSwap(
  targetPath: string,
  build: (tempPath: string) => Promise<void>,
): Promise<void>;

export async function atomicWriteFile(targetPath: string, content: string): Promise<void>;
```

`buildAndSwap` creates the parent folder, lets `build` write a sibling temp file, then renames it onto the target. `atomicWriteFile` is `buildAndSwap` with a plain `writeFile` build.

## `src/core/fs/atomic-rename.ts` (issue #647)

```ts
export const RENAME_MAX_ATTEMPTS = 5;

export async function renameWithRetry(
  from: string,
  to: string,
  deps?: RenameWithRetryDeps,
): Promise<void>;

export function renameWithRetrySync(from: string, to: string, deps?: RenameWithRetrySyncDeps): void;
```

The last step of a temp-then-rename write. On win32 it retries `EPERM`, `EACCES` and `EBUSY` up to five attempts with waits of 10, 20, 40 and 80 ms. Everywhere else, and for any other error, it throws at once. When it gives up it removes `from` and rethrows the rename error.

`deps` lets tests swap in `rename`, `remove`, `sleep` and `platform`. Each defaults to the real thing.
