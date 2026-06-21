# Cross-Provider Parity

paqad ships one behaviour to the 10+ host agents in `ADAPTER_TYPES` (claude-code,
codex-cli, gemini-cli, cursor, windsurf, github-copilot, junie, continue,
antigravity, aider). A capability wired into a single host's hooks silently does
nothing on the others — the class of bug where the evidence ledger was produced
under Claude Code only, because only `ClaudeCodeAdapter` rendered the
verification-completion hook into its host config. These rules keep agent-facing
behaviour at provider parity. Entry files stay out of it — see
`agent-entry-files.md`.

- **Two tiers, in this order.** (1) **Provider-native first:** use the host's own
  hook system (the same way Claude Code's `Stop` hook already works). (2)
  **paqad's own backstop as the fallback:** the provider-independent git/CI
  backstop (`runtime/scripts/verify-backstop.mjs`) running the same
  `runRepositoryVerification`, for hosts with no native hook. Tier 1 is the
  preferred, deterministic path; tier 2 catches everything tier 1 cannot. Never
  rely on a prompt instruction in the entry file as the trigger.
- Render host-triggered behaviour into each host's **native** config, not one
  host's. A completion-time write (evidence ledger, receipts, module-health) must
  be emitted into every hook-capable host's real hook file from one shared
  definition — Claude `.claude/settings.json` `Stop`, Codex `.codex/hooks.json`
  `Stop`, Gemini `.gemini/settings.json` `AfterAgent` — via
  `src/adapters/shared/native-completion-hook.ts`. Never leave it in
  `ClaudeCodeAdapter` alone.
- Verify each host's hook surface against that host's own documentation before
  wiring it; never invent an event name, config-file path, or schema. A host with
  no native hook surface (aider, antigravity, …) is covered by the
  provider-independent git/CI backstop, not by a hook.
- Do not close a host-trigger gap by editing the prose entry file
  (`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`) or its template under
  `runtime/templates/agent-configs/`. Entry-file instructions are model-dependent
  and pollute the contract; host triggers belong in the hook layer, invisible to
  the user.
- Point a non-Claude completion hook at the record-only script
  (`runtime/hooks/verification-record.mjs`, `PAQAD_COMPLETION_RECORD_SCRIPT`),
  which writes the ledger but always exits 0 and stays silent — so a host that
  reads a Stop-hook's exit code or stdout as a control decision is never
  disrupted.
- When an adapter overrides `generateConfig`/`installHooks` to emit a host config
  file, write the real file the host executes and send the base `installHooks`
  sidecar metadata to a paqad-internal path (e.g. `.codex/settings.hooks.json`),
  mirroring Claude's `.claude/settings.hooks.json`, so the two never collide.
- Prove parity with a test that asserts every hook-wired host emits the hook in
  its native config and **not** in its entry file — see
  `tests/unit/adapters/completion-hook-parity.test.ts`. A capability without such
  a test is treated as single-host until one exists.
