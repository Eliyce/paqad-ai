# Cross-Platform Hooks

Every hook paqad wires into a host's settings (Claude Code `.claude/settings.json`,
Codex `.codex/hooks.json`, Gemini `.gemini/settings.json`, …) MUST run on Windows
as well as macOS and Linux. The blocking gates (PreToolUse / UserPromptSubmit /
SessionStart) fire on every edit, prompt, and session start, so a POSIX-only hook
command hard-fails a Windows user on every action in an onboarded project
(issue #240).

A bare command like `~/.paqad-ai/current/hooks/agent-entry-gate.sh` breaks three
independent ways on Windows: `~` is not expanded by cmd.exe / PowerShell, `.sh`
has no interpreter (Windows ships no bash), and a `#!/usr/bin/env node` shebang is
ignored. Renaming `.sh` to `.mjs` alone does NOT fix it — the bare-path invocation
is the root cause.

Rules:

- **No new `.sh` hook may be wired into a generated host config.** New hooks are
  Node (`.mjs`). Mechanical work that used to live in a shell gate lives in a
  cross-platform `.mjs` instead.
- **Every wired hook command launches through an explicit interpreter with an
  absolute path** — `node "<abs>/hooks/<name>.mjs"`, built by
  `hookCommand()` in `src/adapters/shared/paqad-hooks.ts`. No hook command may
  rely on `~` expansion, a shebang, or the executable bit to launch.
- **The absolute path is recomputed from the local home dir at generate time**, so
  it stays machine-agnostic across re-onboards rather than baking one machine's
  path into a shared file.
- **Retired commands are pruned on re-onboard** (a clean cutover, no migration):
  the old `.sh` and bare-path `.mjs` forms are removed from an existing config so
  they never linger beside their replacement.

How this is checked: `tests/unit/adapters/cross-platform-hooks.test.ts` generates
every adapter's config and asserts no hook command targets a `.sh`, none relies on
a bare `~`, and every paqad hook launches via `node`. The
`cross-provider-parity.md` rule already requires host-triggered behaviour to be
proven by a test; this extends that to "and it must run on every OS." A
`windows-latest` CI job runs onboarding and fires a hook end to end so a
regression fails loudly.
