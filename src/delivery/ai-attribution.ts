// The host-agent AI attribution marker table and detector (issue #538).
//
// paqad writes none of these strings. Each is a CODING AGENT's own default: the trailer it
// appends to your commit, or the line it adds to your PR body. The trailer is the part that
// matters commercially — a `Co-Authored-By:` trailer is what makes a git host list the AI
// vendor as a CONTRIBUTOR on the repository, which is the thing an enterprise buyer rejects.
//
// Why a table and not just "strip everything that looks like a co-author": a co-author trailer
// naming a real human colleague is legitimate and must survive. Only known AI-vendor markers
// are matched, each with the exact remediation for that vendor, because the remediation differs:
//
//   - Claude Code and Aider expose a PROJECT-level knob, so paqad writes it at onboarding.
//   - Cursor and Codex expose only USER-level config under the developer's home directory,
//     which onboarding has no business writing (INV-1). paqad reports the fix instead.
//   - Gemini CLI adds no attribution by default; its marker is here only so a hand-added one
//     is still caught.
//
// INV-2, load-bearing: nothing in this table may match paqad's own delivery footer
// ("Generated with paqad-ai delivery"). paqad is the customer's own governance tool, not a
// third-party AI vendor, and that footer is a feature they bought (decision
// D-01M2591H8DFAD1AK6JG1SFZWYV). Every pattern below is anchored on a vendor NAME for exactly
// that reason — none of them keys off the generic "Generated with" phrasing alone.

/** One known host-agent attribution marker. */
export interface AttributionMarker {
  /** Stable id, safe to persist in the delivery ledger. */
  id: string;
  /** Human-readable vendor name, used in the warning the developer reads. */
  vendor: string;
  /** Matches the vendor's commit trailer or PR body line. Deliberately not global. */
  pattern: RegExp;
  /** True when paqad writes a project-level knob for this vendor at onboarding. */
  configuredByPaqad: boolean;
  /** The exact fix for this vendor, quoted verbatim to the developer. */
  remediation: string;
}

/** One detected marker plus the literal text that matched, for the warning message. */
export interface AttributionMatch {
  marker: AttributionMarker;
  matched: string;
}

/**
 * The known third-party AI attribution markers. Every pattern is anchored on a vendor name
 * (INV-2) and is intentionally case-insensitive: the vendors are not consistent about the
 * casing of `Co-Authored-By` vs `Co-authored-by`.
 */
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

/**
 * Every known AI-vendor attribution marker present in `text`, at most one entry per vendor.
 * Text is typically a commit message or a PR body. Returns an empty array for text that
 * carries no marker — including paqad's own delivery footer, which is never a match (INV-2).
 */
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

/** True when `text` carries any known AI-vendor attribution. */
export function hasAiAttribution(text: string): boolean {
  return detectAiAttribution(text).length > 0;
}
