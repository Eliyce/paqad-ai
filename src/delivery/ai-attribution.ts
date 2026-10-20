export interface AttributionMarker {
  id: string;
  vendor: string;
  pattern: RegExp;
  configuredByPaqad: boolean;
  remediation: string;
}

export interface AttributionMatch {
  marker: AttributionMarker;
  matched: string;
}

export const AI_ATTRIBUTION_MARKERS: readonly AttributionMarker[] = [
  {
    id: 'claude-code',
    vendor: 'Claude Code',
    pattern: /(?:co-authored-by:\s*claude\b|generated with \[?claude code)/i,
    configuredByPaqad: true,
    remediation:
      'paqad writes `attribution: { commit: "", pr: "", sessionUrl: false }` into ' +
      '`.claude/settings.json` at onboarding. If the trailer is still appearing, that file was ' +
      'edited or a higher-precedence settings file overrides it (`.claude/settings.local.json`, ' +
      'then the command line, then managed settings).',
  },
  {
    id: 'codex-cli',
    vendor: 'Codex CLI',
    pattern: /co-authored-by:\s*codex\b/i,
    configuredByPaqad: false,
    remediation:
      'Codex only exposes this in your home directory, which paqad will not write. Set ' +
      '`commit_attribution = ""` in `~/.codex/config.toml`.',
  },
  {
    id: 'cursor',
    vendor: 'Cursor',
    pattern: /(?:co-authored-by:\s*cursor\b|made[- ]with:?\s*cursor\b)/i,
    configuredByPaqad: false,
    remediation:
      'Cursor only exposes this in your home directory, which paqad will not write. Set ' +
      '`attribution.attributeCommitsToAgent` to false in `~/.cursor/cli-config.json`, or turn ' +
      'it off for everyone from the Cursor admin dashboard.',
  },
  {
    id: 'aider',
    vendor: 'Aider',
    pattern: /co-authored-by:\s*aider\b/i,
    configuredByPaqad: true,
    remediation:
      'paqad writes `attribute-author`, `attribute-committer` and `attribute-co-authored-by` as ' +
      'false into `.aider.conf.yml` at onboarding. If the trailer is still appearing, that file ' +
      'was edited or aider was run with an explicit `--attribute-…` flag.',
  },
  {
    id: 'github-copilot',
    vendor: 'GitHub Copilot',
    pattern: /co-authored-by:\s*(?:copilot\b|copilot-swe-agent\b)/i,
    configuredByPaqad: false,
    remediation:
      'The Copilot coding agent commits under its own GitHub identity; there is no project file ' +
      'to set. Control it from your organisation’s Copilot policy settings on GitHub.',
  },
  {
    id: 'gemini-cli',
    vendor: 'Gemini CLI',
    pattern: /(?:co-authored-by:\s*gemini\b|generated with gemini\b)/i,
    configuredByPaqad: false,
    remediation:
      'Gemini CLI adds no attribution by default, so this was added by hand or by a local ' +
      'commit template. Remove it from whatever added it.',
  },
];

export function detectAiAttribution(text: string): AttributionMatch[] {
  if (!text) {
    return [];
  }
  const matches: AttributionMatch[] = [];
  for (const marker of AI_ATTRIBUTION_MARKERS) {
    const found = marker.pattern.exec(text);
    if (found) {
      matches.push({ marker, matched: found[0] });
    }
  }
  return matches;
}

export function hasAiAttribution(text: string): boolean {
  return detectAiAttribution(text).length > 0;
}
