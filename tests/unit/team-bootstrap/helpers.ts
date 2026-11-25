import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const HOME_PATH_PATTERN = /\/Users\/[^/\s"']+|\/home\/[^/\s"']+|C:\\\\?Users\\\\?[^\\\s"']+/;

export async function writeTeamSetup(root: string): Promise<void> {
  const { ClaudeCodeAdapter } = await import('@/adapters/claude/claude-adapter.js');
  const { syncTeamSetup } = await import('@/adapters/claude/team-setup.js');
  for (const file of new ClaudeCodeAdapter().hostSettingsFiles(root, {})) {
    mkdirSync(join(root, file.path, '..'), { recursive: true });
    writeFileSync(join(root, file.path), file.content);
  }
  syncTeamSetup(root, {});
}
