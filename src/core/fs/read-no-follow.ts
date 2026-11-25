import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';

export type NoFollowRead =
  | { kind: 'file'; text: string }
  | { kind: 'missing' }
  | { kind: 'symlink' }
  | { kind: 'other'; error: NodeJS.ErrnoException };

export function noFollowFlag(): number {
  return constants.O_NOFOLLOW ?? 0;
}

function asErrno(error: unknown): NodeJS.ErrnoException {
  return error as NodeJS.ErrnoException;
}

function notAFile(path: string): NoFollowRead {
  const error: NodeJS.ErrnoException = new Error(`EISDIR: not a regular file, read '${path}'`);
  error.code = 'EISDIR';
  return { kind: 'other', error };
}

export function readFileNoFollow(path: string): NoFollowRead {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return { kind: 'symlink' };
    if (!stat.isFile()) return notAFile(path);
  } catch (error) {
    return asErrno(error).code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'other', error: asErrno(error) };
  }
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | noFollowFlag());
  } catch (error) {
    const code = asErrno(error).code;
    if (code === 'ELOOP') return { kind: 'symlink' };
    if (code === 'ENOENT') return { kind: 'missing' };
    return { kind: 'other', error: asErrno(error) };
  }
  try {
    if (!fstatSync(fd).isFile()) return notAFile(path);
    return { kind: 'file', text: readFileSync(fd, 'utf8') };
  } finally {
    closeSync(fd);
  }
}

export function readTextNoFollow(path: string): string | null {
  const read = readFileNoFollow(path);
  return read.kind === 'file' ? read.text : null;
}

export function writeFileNoFollow(path: string, text: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollowFlag(),
    0o644,
  );
  try {
    writeSync(fd, text, 0, 'utf8');
  } finally {
    closeSync(fd);
  }
}
