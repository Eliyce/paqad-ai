# CLI Runtime

How the CLI uses its runtime packages: commander, prompts, chalk, execa, fast-glob, pathe, minimatch and handlebars. Found by rules discovery from each package's own docs.

<!-- trigger: ** -->

- package.json engines.node is at least ">=22.12.0" while commander 15 is a dependency. <!-- @rule RL-abe7 discovered:rd-20261116-061901 -->
- The CLI entry calls program.parseAsync(), never program.parse(), because action handlers are async. <!-- @rule RL-9ac7 discovered:rd-20261116-061901 -->
- When a command defines both --foo and --no-foo, the default value is set explicitly on the option instead of relying on an implicit true. <!-- @rule RL-74dc discovered:rd-20261116-061901 -->
- Code does not call cmd.storeOptionsAsProperties() or cmd.combineFlagAndOptionalValue(). <!-- @rule RL-184f discovered:rd-20261116-061901 -->
- A user pressing Ctrl+C at any @inquirer/prompts prompt is handled by catching the ExitPromptError (by error.name) and exiting cleanly, either at each call site or once around program.parseAsync(). <!-- @rule RL-46d8 discovered:rd-20261116-061901 -->
- Text written to process.stderr is styled with chalkStderr (or a colour function chosen from supportsColorStderr), not the default chalk instance. <!-- @rule RL-4917 discovered:rd-20261116-061901 -->
- execa calls to network-bound or long-running tools (gh, git clone, npm install, npx) set a timeout option. <!-- @rule RL-980e discovered:rd-20261116-061901 -->
- Node ChildProcess APIs (.on, .once, .send, .ref, .unref) on an execa subprocess are reached through subprocess.nodeChildProcess. <!-- @rule RL-884a discovered:rd-20261116-061901 -->
- Variable path segments interpolated into fast-glob patterns (module names, directory names) are passed through fg.escapePath() first. <!-- @rule RL-271a discovered:rd-20261116-061901 -->
- fast-glob results are sorted before they are written to output, hashed, or used where order matters. <!-- @rule RL-f6f8 discovered:rd-20261116-061901 -->
- Every fast-glob call passes an explicit cwd instead of relying on process.cwd(). <!-- @rule RL-69ca discovered:rd-20261116-061901 -->
- Paths that are persisted (JSON/YAML/Markdown artifacts) or compared as strings are built with pathe, not node:path. <!-- @rule RL-4eb1 discovered:rd-20261116-061901 -->
- Code does not use minimatch makeRe(), Minimatch#regexp or the MMRegExp type. <!-- @rule RL-5e00 discovered:rd-20261116-061901 -->
- Paths passed to Minimatch.match() are normalized to forward slashes before matching. <!-- @rule RL-9eaf discovered:rd-20261116-061901 -->
- Handlebars templates that render non-HTML output (Markdown, TOML, YAML, scripts) are compiled with noEscape: true, and values are escaped for the target format by an explicit helper. <!-- @rule RL-f3f9 discovered:rd-20261116-061901 -->
- Handlebars.compile is called with strict: true so a template referencing a missing field throws instead of rendering an empty string. <!-- @rule RL-3991 discovered:rd-20261116-061901 -->
