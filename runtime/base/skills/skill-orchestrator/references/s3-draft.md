# S3 draft

verified: 2026-10-31

Draft the folder outside every skills root; `paqad-ai skill draft` copies it into the workspace and it stays there until release.

- `name` equals the folder, lowercase and hyphenated, starting with a gerund.
- `description` says in the third person what the skill does, then a "Use when" clause naming the situations. Lean towards triggering. Keep it within 1024 characters.
- The body stays under 500 lines and the token limit, has a numbered workflow with a checklist, gives one default per decision, has a Gotchas section, and has an output template when the intake fixed a format.
- Point to each reference file from the body with a sentence saying when to read it. References stay one level deep. A reference over 100 lines starts with a table of contents.
- Put every fragile or repeated step in a script under `scripts/`, and say whether it is run or read and which packages it uses.
- Keep timestamps, counters and per-run data out of the body and the references.

`trace.md` maps each block (heading plus line range) to S-IDs:

```markdown
| Block               | Lines | S-IDs    |
| ------------------- | ----- | -------- |
| Processing invoices | 5-12  | S-1, S-3 |

## Unsourced

- Gotchas (lines 14-20): model-knowledge: why this needs no source
```

An unmapped block is listed under Unsourced and the gate fails until it carries `accepted: <reason>` or `model-knowledge: <why>`.
