import type { AdapterType } from '@/core/types/adapter.js';

import type { AdapterInterface } from './adapter.interface.js';
import { AiAssistantAdapter } from './aiassistant/aiassistant-adapter.js';
import { AiderAdapter } from './aider/aider-adapter.js';
import { AntigravityAdapter } from './antigravity/antigravity-adapter.js';
import { ClaudeCodeAdapter } from './claude/claude-adapter.js';
import { CodexCliAdapter } from './codex/codex-adapter.js';
import { ContinueAdapter } from './continue/continue-adapter.js';
import { CursorAdapter } from './cursor/cursor-adapter.js';
import { GeminiCliAdapter } from './gemini/gemini-adapter.js';
import { GithubCopilotAdapter } from './github-copilot/github-copilot-adapter.js';
import { JunieAdapter } from './junie/junie-adapter.js';
import { WindsurfAdapter } from './windsurf/windsurf-adapter.js';

function assertUnreachableAdapter(type: never): never {
  throw new Error(`Unsupported adapter type: ${String(type)}`);
}

export class AdapterFactory {
  static create(type: AdapterType): AdapterInterface {
    switch (type) {
      case 'claude-code':
        return new ClaudeCodeAdapter();
      case 'codex-cli':
        return new CodexCliAdapter();
      case 'antigravity':
        return new AntigravityAdapter();
      case 'gemini-cli':
        return new GeminiCliAdapter();
      case 'junie':
        return new JunieAdapter();
      case 'cursor':
        return new CursorAdapter();
      case 'github-copilot':
        return new GithubCopilotAdapter();
      case 'windsurf':
        return new WindsurfAdapter();
      case 'continue':
        return new ContinueAdapter();
      case 'aider':
        return new AiderAdapter();
      case 'aiassistant':
        return new AiAssistantAdapter();
      default:
        return assertUnreachableAdapter(type);
    }
  }
}
