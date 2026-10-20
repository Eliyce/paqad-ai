---
'paqad-ai': patch
---

Safer plugin move, honest gates and a cleaner codebase.

- **Plugin move.** The move checks managed policy first, spots a claude.ai copy, finds the Desktop app's own `claude` (Windows too) and installs from the published plugin repo. Only one plugin copy runs per session, and plugin onboarding writes no hook chain.
- **Session-safe stage rows.** Stage-agent rows carry the session that dispatched them and the subagent's own tokens. Decisions are judged by when they were opened, and the rules-loaded check is skipped on CI.
- **Honest checks.** A test step with no readable results reads inconclusive, not passed. A project with no `package.json` still gets the usual Node commands, mapped from the lockfile and the scripts that exist.
- **Safe config writes.** An older paqad never rewrites tracked config from a newer checkout, `project-profile.yaml` is edited in place, and `update` refreshes the managed `.paqad/.gitignore`. Doctor and rollback say what is installed and what happened.
- **Pentest finding ids.** Finding ids are now built with sha256, so every id changes once with this release, and a retest still pairs the old findings with the new ones.
- **No comments and no issue numbers.** The code no longer carries comments or issue numbers, and two strict rule scripts keep it that way in this repo. Onboarded projects are not affected.
