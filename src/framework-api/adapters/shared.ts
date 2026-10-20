import { relative } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';

import type { FrameworkApiSymbol } from '../types.js';

export const DYNAMIC_MEMBER_SUFFIX = '.*';

export function projectRelative(projectRoot: string, target: string): string {
  return toPosixPath(relative(projectRoot, target));
}

export function dynamicRecord(container: string): FrameworkApiSymbol {
  return {
    name: `${container}${DYNAMIC_MEMBER_SUFFIX}`,
    kind: 'member',
    exists: true,
    deprecated: false,
    message: null,
    since: null,
    for_removal: false,
    provenance: 'unknown-dynamic',
  };
}

const NAME_SEPARATORS = ['::', '.', '\\'];

function lastSeparator(name: string): { at: number; width: number } {
  let at = -1;
  let width = 0;
  for (const separator of NAME_SEPARATORS) {
    const index = name.lastIndexOf(separator);
    if (index > at) {
      at = index;
      width = separator.length;
    }
  }
  return { at, width };
}

export function lastNameSegment(name: string): string {
  const { at, width } = lastSeparator(name);
  return at === -1 ? name : name.slice(at + width);
}

export function containerOf(name: string): string | null {
  const { at } = lastSeparator(name);
  return at === -1 ? null : name.slice(0, at);
}
