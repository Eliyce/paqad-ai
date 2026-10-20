# Comments and Issue Numbers

Code says what it does. `docs/` says why. Git says when and for which issue. Specific to this repo (paqad-ai).

<!-- trigger: ** -->

- MUST NOT add a comment to a code file. Put the reason in the module or feature doc under `docs/modules/` instead. Tool directives are not comments and stay: a shebang, `eslint-disable`, `@ts-expect-error`, `@ts-ignore`, `prettier-ignore`, coverage ignores (`istanbul`, `c8`, `v8`), `/// <reference`, `@vitest-environment`, `/* @vite-ignore */`, and the `// @paqad-rule-script` header of a rule script. <!-- @rule RL-3059 -->
- When you find a comment in a file you are changing, delete it. If it explains something the docs don't, move that explanation into the right doc in the same change first. <!-- @rule RL-7a67 -->
- MUST NOT write an issue or pull request number (`#123`, `issue 123`, `PR 123`) in code, test names, generated text, rules, workflows or canonical docs under `docs/`. `git log`, `git blame` and the PR keep that history. <!-- @rule RL-132e -->

## Verify

```bash
SE_SESSION=$CLAUDE_SESSION_ID paqad-ai checks run
```
