import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectProfile } from '@/core/types/project-profile.js';

const spawned = vi.hoisted(() => [] as Array<import('execa').ResultPromise>);
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  const run = actual.execa as unknown as (...args: unknown[]) => import('execa').ResultPromise;
  return {
    ...actual,
    execa: (...args: unknown[]) => {
      const subprocess = run(...args);
      vi.spyOn(subprocess.nodeChildProcess, 'unref');
      spawned.push(subprocess);
      return subprocess;
    },
  };
});

import { bootApp } from '@/visual-evidence/boot.js';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function profileFor(url: string, command: string, waitMs: number): ProjectProfile {
  return { app_preview: { url, command, wait_ms: waitMs } } as unknown as ProjectProfile;
}

async function exited(subprocess: import('execa').ResultPromise): Promise<void> {
  const child = subprocess.nodeChildProcess;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => child.once('exit', resolve));
}

let root: string;
let unhandled: unknown[];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-ve-boot-'));
  writeFileSync(
    join(root, 'server.mjs'),
    "import { createServer } from 'node:http';\n" +
      "createServer((_req, res) => res.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');\n",
  );
  writeFileSync(join(root, 'idle.mjs'), 'setInterval(() => undefined, 1000);\n');
  spawned.length = 0;
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(async () => {
  process.off('unhandledRejection', onUnhandled);
  for (const subprocess of spawned) {
    subprocess.nodeChildProcess.kill('SIGKILL');
  }
  rmSync(root, { recursive: true, force: true });
});

describe('bootApp on execa 10', () => {
  it('unrefs the booted dev server and stop() kills it without an unhandled rejection', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;

    const result = await bootApp(root, profileFor(url, `node server.mjs ${port}`, 15000));

    expect(result.ok).toBe(true);
    expect(spawned).toHaveLength(1);
    const subprocess = spawned[0]!;
    expect(subprocess.nodeChildProcess.unref).toHaveBeenCalledTimes(1);

    if (result.ok) await result.stop();
    await exited(subprocess);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unhandled).toEqual([]);
  }, 20000);

  it('kills a server that never answers and reports app-not-reachable without an unhandled rejection', async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;

    const result = await bootApp(root, profileFor(url, 'node idle.mjs', 1500));

    expect(result).toMatchObject({ ok: false, reason: 'app-not-reachable' });
    expect(spawned).toHaveLength(1);
    const subprocess = spawned[0]!;
    expect(subprocess.nodeChildProcess.unref).toHaveBeenCalledTimes(1);
    await exited(subprocess);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unhandled).toEqual([]);
  }, 20000);
});
