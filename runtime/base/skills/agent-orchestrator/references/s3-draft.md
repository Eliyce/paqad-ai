# S3 draft

verified: 2026-11-01

Draft the agent file and its hook scripts outside every agents folder, so nothing loads them until S7 writes them.

Frontmatter:

- `name` names the role as an object noun, as in `migration-reviewer`.
- `description` opens with `Use this agent when` and gives two example requests; a dispatched agent says who dispatches it.
- `tools` is the smallest list; `model` is the tier S5 proves; `maxTurns` is always set; `effort` is fixed.
- `memory: project` only when S5 kept the memory arm, `isolation: worktree` only when the intake says so.
- Every rule that must never break has a hook naming a script with a test.

Body headings, in this order: `Objective`, `Procedure`, `Report`, `Stop when`, `Do not`, `Example`. The report shows the `Status:` line and the blocked shape (`Status: BLOCKED`, `Decision needed:`, `Options:`).

Map every block to S-IDs in `trace.md`, then run `paqad-ai agent draft <name> --file <agent.md> --trace trace.md`. It also writes `brief-template.md` for callers.
