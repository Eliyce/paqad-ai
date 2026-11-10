import type { EcosystemParser, ParsedLockfile, ParsedManifest } from './types.js';

export const goParser: EcosystemParser = {
  ecosystem: 'go',
  packageManager: 'go',
  manifestFiles: ['go.mod'],
  lockfileFiles: ['go.sum'],
  parseManifest(content: string): ParsedManifest {
    return {
      ecosystem: 'go',
      packages: goRequireLines(content)
        .map((line) => /^([^\s]+)\s+([^\s]+)/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({
          name: match[1] as string,
          constraint: match[2] as string,
          isDev: false,
        })),
    };
  },
  parseLockfile(content: string): ParsedLockfile {
    return {
      ecosystem: 'go',
      packages: content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => {
          const [name, version] = line.split(/\s+/, 3);
          if (!name || !version) {
            return null;
          }
          return { name, version };
        })
        .filter((entry): entry is { name: string; version: string } => entry !== null),
    };
  },
};

function goRequireLines(content: string): string[] {
  const lines: string[] = [];
  let inBlock = false;
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (inBlock) {
      if (line === ')') {
        inBlock = false;
      } else if (line !== '') {
        lines.push(line);
      }
      continue;
    }
    if (/^require\s*\($/.test(line)) {
      inBlock = true;
    } else if (line.startsWith('require ')) {
      lines.push(line.slice('require '.length).trim());
    }
  }
  return lines;
}

export function goLocalReplacements(content: string): string[] {
  const names: string[] = [];
  let inBlock = false;
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (/^replace\s*\($/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock && line === ')') {
      inBlock = false;
      continue;
    }
    const body = inBlock ? line : line.startsWith('replace ') ? line.slice(8).trim() : null;
    const match = body === null ? null : /^([^\s]+)(?:\s+[^\s]+)?\s*=>\s*([^\s]+)/.exec(body);
    if (match?.[1] && match[2] && /^(\.{1,2}\/|\/)/.test(match[2])) {
      names.push(match[1]);
    }
  }
  return names;
}
