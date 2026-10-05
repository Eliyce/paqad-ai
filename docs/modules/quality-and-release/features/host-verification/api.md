# Manual host verification: API

This feature has no API, no script and no runtime entry point. It is a manual recording harness
for people, in `hosts/claude.md`, `hosts/chatgpt.md` and `hosts/codex.md`. These files are not
shipped in the plugin.

## Contract

Each host file lists the cross-host unknowns (U-1 to U-17) as rows with a check and a `Verdict`
column. A person installs the built plugin on that host, exercises the real entry skills, runs the
listed checks, and fills in each verdict. Every verdict starts as the token `pending`. No
automated host verdict is produced: "packaged" is not "verified" (CI-19), and release notes claim
support only for a host whose verdicts are filled in.
