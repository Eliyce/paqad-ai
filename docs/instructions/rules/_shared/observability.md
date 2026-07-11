# Observability

Baseline logging and error-handling rules for every change, in every stack. These always load.

<!-- trigger: ** -->

- Log each meaningful event with structured context, an identifier, the operation, and the outcome, so one request or job can be traced end to end. <!-- @rule RL-356d -->
- MUST NOT log secrets, credentials, or personal data. Redact them before they reach a log line. <!-- @rule RL-efa4 -->
- Fail loudly: surface an error with an actionable message and MUST NOT swallow an exception into an empty `catch`. <!-- @rule RL-10b3 -->
- Make an externally observable failure diagnosable from logs and metrics alone, without reproducing it locally. <!-- @rule RL-9645 -->

## Verify

```bash
# Swallowed exceptions — an empty catch block (review each hit):
git grep -nE 'catch\s*\([^)]*\)\s*\{\s*\}' -- '*.ts' '*.tsx' '*.js'
# Secrets in log calls — a log statement referencing a secret-ish name (review each hit):
git grep -niE '(console\.(log|error)|logger\.)\b.*(password|secret|token|apikey)' -- '*.ts' '*.tsx'
```
