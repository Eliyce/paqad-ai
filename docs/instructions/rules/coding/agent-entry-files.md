# Keep Agent Entry Files Lean

The per-host entry files paqad generates — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
`.cursor/rules/paqad.mdc`, `.windsurfrules`, `.junie/AGENTS.md`, `ANTIGRAVITY.md`,
`CONVENTIONS.md`, and the rest — are a **lean bootstrap pointer**, nothing more.
The host auto-injects them into every session, so they are the one thing that is
*always* present; they must therefore carry no behavior of their own. They are
rendered from `runtime/templates/agent-configs/*.hbs`. Keep them short and
identical in shape across hosts.

An entry file may contain ONLY:

- a one-line **bootstrap pointer**: open `.paqad/framework-path.txt`, resolve it
  to the framework install directory, and load + follow the framework bootstrap
  it points to (`AGENT-BOOTSTRAP.md` in that directory),
- the core-owned **graceful-degradation clause** (issue #220): "if
  `.paqad/framework-path.txt` is missing or cannot be resolved, or paqad is
  disabled, proceed as a normal assistant with no paqad behavior." It is
  generated once in `BaseAdapter.generateConfig` from
  `framework-fallback-clause.ts` so it is byte-identical across every host, and
  it is deliberately a plain clause, not a `##` heading,
- the `Adapter:` footer — load-bearing: the bootstrap's per-adapter UI table
  (the row that tells the host how to surface a decision pause, e.g. the Claude
  Code `AskUserQuestion` tray) is selected by this footer.

The invariant (issue #229):

- **An entry file may NEVER name a `docs/instructions` or `docs/modules` load
  order.** That order lives only behind the enablement gate — the relocated
  `AGENT-BOOTSTRAP.md` (whose first instruction is the `paqad_enable` check) and,
  on Claude Code, the hooks. This is what makes a *disabled* project load zero
  framework docs on every provider: the always-injected entry file carries no
  load order to follow.
- **An entry file may NEVER inline a contract** (the narration contract, the
  Decision Pause Contract, or any other). Those live in the bootstrap, inline and
  behind the enablement check. Do not re-add a `## paqad in your chat` or
  `## Decision Pause Contract` pointer section.
- **An entry file may NEVER carry a per-feature or per-capability instruction.**
  New agent behaviour goes into the framework — the bootstrap, a host hook, a rule
  under `docs/instructions/rules/**`, or a skill — never into the entry file or its
  `.hbs` template. Host-triggered behaviour belongs in the hook layer (see
  `cross-provider-parity.md`).

The set of `##` headings an entry file may contain is therefore **empty**: a lean
stub has no `##` sections at all. Adding any is a deliberate change to this rule
and its guard test, reviewed on its own. Only the host name, the install path, and
the `Adapter:` value may differ between templates.

How this is checked: `tests/unit/adapters/entry-file-minimal.test.ts` renders
every adapter's entry file and asserts it carries no `## ` sections, names no
`docs/instructions`/`docs/modules` load order, and inlines neither contract — only
the bootstrap pointer, the fallback clause, and the `Adapter:` footer.
