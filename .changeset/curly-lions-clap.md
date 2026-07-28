---
'paqad-ai': patch
---

fix(#449): the completion (Stop) hook no longer forces the feature-development stage set on
host-agent-config-only changes. Paqad's own host-integration directories (`.claude/`, `.codex/`,
`.gemini/`, `.junie/`, `.cursor/`, `.windsurf/`, `.continue/`, `.aider/`, `.aiassistant/`) and the
`.windsurfrules` entry file are now classified as non-feature-development in the scope predicate, so
a session that only touches host wiring (e.g. regenerated hooks or an `mcp.json` edit) ends cleanly
instead of hard-blocking with a false "missing stage-evidence" failure. `.github/` stays in scope
(CI workflows are real code). Also fixes the #409 narration advisory so it only names stages the
agent itself authored (`live-mark`/`redo`), never a hook/backstop-inferred stage the agent never
claimed.
