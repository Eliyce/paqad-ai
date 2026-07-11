# Cross-Platform Hooks

Every hook paqad wires into a host's settings (Claude Code `.claude/settings.json`, Codex `.codex/hooks.json`, Gemini `.gemini/settings.json`) must run on Windows as well as macOS and Linux. The blocking gates fire on every edit, prompt, and session start, so a POSIX-only hook command hard-fails a Windows user on every action in an onboarded project (issue #240). Specific to this repo (paqad-ai).

A bare command like `~/.paqad-ai/current/hooks/agent-entry-gate.sh` breaks three independent ways on Windows: `~` is not expanded by cmd.exe or PowerShell, `.sh` has no interpreter, and a `#!/usr/bin/env node` shebang is ignored. Renaming `.sh` to `.mjs` alone does not fix it. The bare-path invocation is the root cause.

- Wire only Node (`.mjs`) hooks into a generated host config. MUST NOT add a new `.sh` hook; move mechanical shell-gate work into a cross-platform `.mjs` instead. <!-- @rule RL-4562 -->
- Launch every wired hook through an explicit interpreter with an absolute path: `node "<abs>/hooks/<name>.mjs"`, built by `hookCommand()` in `src/adapters/shared/paqad-hooks.ts`. MUST NOT rely on `~` expansion, a shebang, or the executable bit. <!-- @rule RL-d898 -->
- Recompute the absolute path from the local home directory at generate time, so it stays machine-agnostic across re-onboards instead of baking one machine's path into a shared file. <!-- @rule RL-4d16 -->
- Prune the retired command forms (the old `.sh` and the bare-path `.mjs`) from an existing config on re-onboard, so they never linger beside their replacement. <!-- @rule RL-2f32 -->

## Verify

```
tests/unit/adapters/cross-platform-hooks.test.ts generates every adapter's config and asserts no
hook command targets a `.sh`, none relies on a bare `~`, and every paqad hook launches via node.
A windows-latest CI job runs onboarding and fires a hook end to end so a regression fails loudly.
```
