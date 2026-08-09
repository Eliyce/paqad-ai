---
'paqad-ai': patch
---

fix(#205): never count generated `.paqad/` artifacts as changed code in verification

When the runtime self-hosts, its generated artifacts land under a nested
`.paqad/` home (`runtime/base/.paqad/`) that the root-only managed gitignore does
not cover, so they leak into the working tree. The change-evidence classifier
treated anything under `runtime/` as code, so the change-completeness gate demanded
test evidence and doc updates for generated logs and evidence JSON. `isCodeFile`
now excludes every `.paqad/` home (root or nested) via the new
`isPaqadArtifactPath` predicate, and the verification changed-file scan strips
`.paqad/` artifacts entirely, so they never reach `code_changed`, the test-evidence
preview, the quality ratchet, or scope drift. (The invisible Stop-hook loop and the
silent exit-2 from the original report were already resolved by #303/#368.)
