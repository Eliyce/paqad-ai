import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function buildAndSwap(
  targetPath: string,
  build: (tempPath: string) => Promise<void>,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp.${process.pid}.${nextTempSeq()}`;
  await build(tempPath);
  await rename(tempPath, targetPath);
}

export async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  await buildAndSwap(targetPath, (tempPath) => writeFile(tempPath, content, 'utf8'));
}

let tempSeq = 0;

function nextTempSeq(): number {
  tempSeq = (tempSeq + 1) % Number.MAX_SAFE_INTEGER;
  return tempSeq;
}
