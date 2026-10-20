import { createHash } from 'node:crypto';

import { loadRuleScriptMap, serializeRuleScriptMap } from './map.js';
import { scriptFilesHash } from './runner.js';

export function computeRuleScriptsDigest(projectRoot: string): string | null {
  const map = loadRuleScriptMap(projectRoot);
  if (!map) {
    return null;
  }
  const hash = createHash('sha256');
  hash.update(serializeRuleScriptMap(map));
  hash.update('\0');
  hash.update(scriptFilesHash(projectRoot, map));
  return hash.digest('hex');
}
