# Keep Agent Entry Files Lean

The per-host entry files paqad generates, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursor/rules/paqad.mdc`, `.windsurfrules`, `.junie/AGENTS.md`, `ANTIGRAVITY.md`, `CONVENTIONS.md`, and the rest, are a lean bootstrap pointer and nothing more. The host injects them into every session, so they are the one thing always present; they must carry no behavior of their own. They are rendered from `runtime/templates/agent-configs/*.hbs`. Keep them short and identical in shape across hosts. Specific to this repo (paqad-ai).

An entry file may contain only these three things:

```
1. a one-line bootstrap pointer — open .paqad/framework-path.txt, resolve it to the
   framework install directory, and load + follow AGENT-BOOTSTRAP.md there;
2. the core-owned graceful-degradation clause (issue #220), generated once from
   framework-fallback-clause.ts so it is byte-identical across hosts, written as a
   plain clause (deliberately not a ## heading);
3. the Adapter: footer — load-bearing, because the bootstrap's per-adapter UI table
   (which tells the host how to surface a decision pause) is selected by it.
```

- An entry file MUST NOT name a `docs/instructions` or `docs/modules` load order. That order lives only behind the enablement gate, which is what makes a disabled project load zero framework docs on every provider. <!-- @rule RL-5cfc -->
- An entry file MUST NOT inline a contract (the narration contract, the Decision Pause Contract, or any other); those live in the bootstrap, behind the enablement check. <!-- @rule RL-487c -->
- An entry file MUST NOT carry a per-feature or per-capability instruction. New agent behavior goes into the framework (the bootstrap, a host hook, a rule under `docs/instructions/rules/**`, or a skill), never the entry file or its `.hbs` template. <!-- @rule RL-a289 -->
- An entry file MUST NOT contain any `## ` section. A lean stub has none. Only the host name, install path, and `Adapter:` value may differ between templates. Adding a section is a deliberate change to this rule and its guard test, reviewed on its own. <!-- @rule RL-6e28 -->

## Verify

```
tests/unit/adapters/entry-file-minimal.test.ts renders every adapter's entry file and asserts
it carries no `## ` section, names no docs/instructions or docs/modules load order, and inlines
neither contract — only the bootstrap pointer, the fallback clause, and the Adapter: footer.
```
