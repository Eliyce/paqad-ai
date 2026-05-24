import { sep } from 'node:path';

/**
 * Normalize a filesystem path to forward-slash (POSIX) style on every platform.
 *
 * Use this at every **output boundary** where a path is surfaced to a user or
 * consumer — JSON files, markdown reports, manifests, console logs, public
 * API return values. Internal filesystem operations can continue to use
 * `path.join` and friends; Node accepts mixed separators on Windows.
 *
 * On POSIX the function is effectively a no-op.
 *
 * @example
 *   toPosixPath('docs\\modules\\foo')   // -> 'docs/modules/foo'
 *   toPosixPath('docs/modules/foo')     // -> 'docs/modules/foo'
 *   toPosixPath('C:\\Users\\a\\.paqad') // -> 'C:/Users/a/.paqad'
 */
export function toPosixPath(path: string): string {
  return path.split(sep).join('/');
}
