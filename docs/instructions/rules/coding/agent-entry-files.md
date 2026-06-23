# Keep Agent Entry Files Minimal

The per-host entry files paqad generates — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
`.cursor/rules/paqad.mdc`, `.windsurfrules`, `.junie/AGENTS.md`, `ANTIGRAVITY.md`,
`CONVENTIONS.md`, and the rest — are a small, fixed **bootstrap**, not a feature
changelog. They are rendered from `runtime/templates/agent-configs/*.hbs`. Keep
them short and identical in shape across hosts so every agent reads the same
contract and the file a human opens stays readable.

An entry file may contain ONLY:

- the numbered bootstrap steps (open `.paqad/framework-path.txt`, load the
  framework entry, load `docs/instructions/{rules,stack,design-system}`, treat
  them as canonical),
- the core-owned graceful-degradation clause that closes the bootstrap (issue
  #220): "if `.paqad/framework-path.txt` is missing or cannot be resolved, or
  paqad is disabled, proceed as a normal assistant with no paqad behavior."
  It is generated once in `BaseAdapter.generateConfig` from
  `framework-fallback-clause.ts` so it is byte-identical across every host, and
  it is deliberately a plain clause, not a `##` heading, so the heading
  allow-list stays closed,
- the short `Workflow handling:` note,
- one-line **pointers** to managed contracts under `.paqad/` — today exactly two
  `##` sections: `## paqad in your chat` → `.paqad/narration-contract.md`, and
  `## Decision Pause Contract` → `.paqad/decision-pause-contract.md`,
- the `Adapter:` footer.

Follow these rules:

- **Never add a per-feature or per-capability instruction to an entry file or its
  `.hbs` template.** New agent behaviour goes into the framework — a host hook, a
  rule under `docs/instructions/rules/**`, a skill, or a managed `.paqad/*.md`
  contract — never inline in the entry file. Host-triggered behaviour belongs in
  the hook layer (see `cross-provider-parity.md`).
- **A new section, if truly unavoidable, is a one-line pointer only.** Add a
  single `## <Name>` heading whose body is one sentence pointing to a managed
  `.paqad/<name>.md` doc. Never inline the procedure. New sections go BEFORE the
  `## Decision Pause Contract` block.
- **The set of `##` headings an entry file may contain is a closed allow-list**
  (`## paqad in your chat`, `## Decision Pause Contract`). Growing it is a
  deliberate change to the allow-list and its guard test, reviewed on its own.
- **Keep the bootstrap identical across hosts.** Only the host name, the
  per-adapter UI note, and file paths may differ between templates.

How this is checked: `tests/unit/adapters/entry-file-minimal.test.ts` renders
every adapter's entry file and asserts its top-level (`## `) headings are a
subset of the allow-list. Any new `## Feature` section fails the suite until the
allow-list is updated on purpose.
