import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as programModule from '@/cli/program';
import { argvToEntrypoint, getCliBanner, runCli, shouldRunFromCommandLine } from '@/cli/index';
import { getFrameworkName, VERSION } from '@/index';

const packageVersion = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

describe('bootstrap', () => {
  it('exposes the package version', () => {
    expect(VERSION).toBe(packageVersion);
  });

  it('exposes the framework name', () => {
    expect(getFrameworkName()).toBe('paqad-ai');
  });

  it('returns the CLI banner', () => {
    expect(getCliBanner()).toBe('paqad-ai');
  });

  it('writes the CLI banner', async () => {
    const parseAsync = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const createProgram = vi
      .spyOn(programModule, 'createProgram')
      .mockReturnValue({ parseAsync, commands: [], options: [] } as never);

    await runCli(['node', 'dist/cli/index.js']);

    expect(parseAsync).toHaveBeenCalledWith(['node', 'dist/cli/index.js']);
    expect(stderrSpy).not.toHaveBeenCalled();
    stderrSpy.mockRestore();
    createProgram.mockRestore();
  });

  it('prints normalization warnings before parsing', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await runCli(['node', 'dist/cli/index.js', 'capabilities', 'available', '--stack', 'laravel']);

    expect(stderrSpy).toHaveBeenCalledWith(
      "warning: ignoring unsupported option '--stack' for command 'capabilities available'\n",
    );
    stderrSpy.mockRestore();
  });

  it('converts argv entries into file URLs when present', () => {
    // Use pathToFileURL to compute the expected value so the test works
    // cross-platform (on Windows `/tmp/foo` resolves to `D:/tmp/foo`).
    const argv = '/tmp/paqad-ai.js';
    expect(argvToEntrypoint(argv)).toBe(pathToFileURL(argv).href);
    expect(argvToEntrypoint(undefined)).toBeUndefined();
  });

  it('falls back to the raw path when argv realpath resolution fails', () => {
    const argv = '/tmp/does-not-exist/paqad-ai.js';
    expect(argvToEntrypoint(argv)).toBe(pathToFileURL(argv).href);
  });

  it('resolves symlinked argv entries to the real command path', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-cli-link-'));
    const realFile = join(root, 'real.js');
    const linkedFile = join(root, 'linked.js');

    writeFileSync(realFile, '');
    symlinkSync(realFile, linkedFile);

    expect(argvToEntrypoint(linkedFile)).toBe(pathToFileURL(realpathSync(realFile)).href);
  });

  it('detects direct command-line execution deterministically', () => {
    // Use pathToFileURL to construct file:// URLs cross-platform.
    const argv = '/tmp/paqad-ai.js';
    const argvUrl = pathToFileURL(argv).href;
    const otherUrl = pathToFileURL('/tmp/other.js').href;
    expect(shouldRunFromCommandLine(argvUrl, argv)).toBe(true);
    expect(shouldRunFromCommandLine(argvUrl, undefined)).toBe(false);
    expect(shouldRunFromCommandLine(otherUrl, argv)).toBe(false);
  });
});
