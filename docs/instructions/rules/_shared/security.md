# Security

Baseline security rules for every change, in every stack. These always load. A stack rule (for example `coding/stacks/react/security.md`) sharpens these with framework specifics; it does not repeat them.

<!-- trigger: ** -->

- Load secrets, credentials, and tokens from environment variables or a secrets manager. MUST NOT commit them or write them into logs, error messages, or docs. <!-- @rule RL-6e3e -->
- Validate and sanitize every external input at the trust boundary before you use it. <!-- @rule RL-cf05 -->
- Build SQL, shell commands, and HTML with parameterized queries, prepared statements, or a safe builder. MUST NOT concatenate untrusted input into them. <!-- @rule RL-54cd -->
- Enforce authentication and authorization on every non-public entry point, and default to deny when a check is missing. <!-- @rule RL-7530 -->
- Grant each integration, token, and file or database handle the least privilege it needs. <!-- @rule RL-f83c -->
- Confirm a destructive or irreversible operation with the user before you run it. <!-- @rule RL-5e26 -->
- Plugin and mod code starts the paqad program only from the plugin root through paqadProgram, never from PATH, and records nothing when that path is missing. <!-- @rule RL-d61d discovered:rd-20261116-061901 -->
- execa calls do not pass shell: true; command strings from config are split with parseCommandString() and run as file + args. <!-- @rule RL-5c21 discovered:rd-20261116-061901 -->
- YAML parse calls never set maxAliasCount: -1 or uniqueKeys: false. <!-- @rule RL-7619 discovered:rd-20261116-061901 -->

## Verify

```bash
# No literal secrets staged (tune the pattern to your key formats):
! git diff --cached | grep -iE '(api[_-]?key|secret|password|token)\s*[:=]\s*["'\''][^"'\'' ]{12,}'
# String-built SQL to review by hand (each hit is a candidate, not a proof):
git grep -nE '(SELECT|INSERT|UPDATE|DELETE)\b.*\+\s*[a-zA-Z_]' -- '*.ts' '*.tsx' '*.js'
# Auth-on-every-entry-point and destructive-op confirmation are manual review against the rules above.
```
