---
'paqad-ai': minor
---

Make the session-context rule contract fail-safe (#316). `writeRuleContext` could
write a drift-, memory-, or retrieval-only artifact with zero rules when the compiled
rules store was absent or empty. Because the framework bootstrap only loads the full
`docs/instructions/rules/` tree when the artifact is _missing_, a rules-less file was
silently treated as the rule contract and every project rule vanished from context.
The writer now prepends an explicit fallback marker to any written artifact that
carries no rule manifest, so a bootstrap-obedient agent always knows to load the rules
in full. A populated store is unchanged (byte-identical).
