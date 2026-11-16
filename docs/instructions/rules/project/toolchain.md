# Toolchain

Build, lint, format, test and release tool settings: TypeScript, ESLint, Prettier, markdownlint, tsup, Vitest and Changesets. Found by rules discovery from each package's own docs.

<!-- trigger: ** -->

- No tsconfig*.json sets `ignoreDeprecations`; options deprecated in TypeScript 6 are migrated instead of silenced. <!-- @rule RL-493a discovered:rd-20261116-061901 -->
- The root tsconfig.json lists its ambient type packages explicitly in `compilerOptions.types` (for example ["node"]) instead of relying on auto-inclusion. <!-- @rule RL-5589 discovered:rd-20261116-061901 -->
- No tsconfig uses `baseUrl`, `moduleResolution` node/node10/classic, `outFile`, `target: es5`, or sets `esModuleInterop`/`allowSyntheticDefaultImports` to false. <!-- @rule RL-df8b discovered:rd-20261116-061901 -->
- eslint.config.js wraps its config in `defineConfig()` from 'eslint/config' instead of the deprecated `tseslint.config()`. <!-- @rule RL-bdaa discovered:rd-20261116-061901 -->
- TypeScript source under src/ is linted with a type-checked preset (`recommendedTypeChecked` or stricter) and `parserOptions.projectService: true`. <!-- @rule RL-8bfe discovered:rd-20261116-061901 -->
- Global ignore patterns in eslint.config.js are declared with `globalIgnores()` rather than an ignores-only config object. <!-- @rule RL-37ba discovered:rd-20261116-061901 -->
- Every TypeScript/TSX tree in the repo (including graph-ui/src) is covered by an ESLint config: either the root config lints it or the sub-project has its own eslint.config.js. <!-- @rule RL-a51b discovered:rd-20261116-061901 -->
- No source file contains an `/* eslint-env */` comment. <!-- @rule RL-cad9 discovered:rd-20261116-061901 -->
- package.json pins prettier to an exact version (no ^ or ~ range). <!-- @rule RL-c50f discovered:rd-20261116-061901 -->
- Every generated file that a golden test compares byte-for-byte is listed in .prettierignore. <!-- @rule RL-8fda discovered:rd-20261116-061901 -->
- If markdownlint-cli2 stays in devDependencies, the repo commits a root .markdownlint-cli2.jsonc (with `globs` and `gitignore: true`) and a package.json script that CI runs; otherwise the dependency is removed. <!-- @rule RL-e3f6 discovered:rd-20261116-061901 -->
- Markdown lint exclusions live in the `ignores`/`gitignore` options of .markdownlint-cli2.jsonc, never in a .markdownlintignore file. <!-- @rule RL-dace discovered:rd-20261116-061901 -->
- Declaration files emitted by tsup (`dts: true`) are checked before publish with `tsc` or @arethetypeswrong/cli in CI. <!-- @rule RL-de32 discovered:rd-20261116-061901 -->
- Every Node version used to build (.nvmrc and CI jobs that run `pnpm build`) is 22.18 or newer, and tsup's `target` equals the engines.node minimum major (node22). <!-- @rule RL-93b1 discovered:rd-20261116-061901 -->
- tsup.config.ts uses no tsup-only extension points (`plugins`, `esbuildPlugins`, `experimentalDts`), so a move to tsdown stays mechanical. <!-- @rule RL-a3d9 discovered:rd-20261116-061901 -->
- Every package.json that depends on vitest also lists `vite` (>=6.4.0) in devDependencies. <!-- @rule RL-92ac discovered:rd-20261116-061901 -->
- Test and config code imports Vitest only from 'vitest', 'vitest/config' or 'vitest/node', never from removed entrypoints (vitest/coverage, /reporters, /environments, /snapshot, /runners, /suite, /mocker) or @vitest/expect. <!-- @rule RL-5061 discovered:rd-20261116-061901 -->
- In each package.json, @vitest/coverage-v8 and vitest use the identical version specifier. <!-- @rule RL-b200 discovered:rd-20261116-061901 -->
- Coverage ignore hints use the documented form `/* v8 ignore <next|start|stop|if|else|file> -- @preserve */`, not bare or `c8 ignore` comments. <!-- @rule RL-201d discovered:rd-20261116-061901 -->
- The @types/node major version in package.json equals the lowest Node major in engines.node (22), not a newer line. <!-- @rule RL-6756 discovered:rd-20261116-061901 -->
- Release scripts and .changeset/config.json use no options removed in Changesets 3 (`changeset tag`, `--sinceMaster`, the `prettier` config key, `pre.json initialVersions`). <!-- @rule RL-5d6c discovered:rd-20261116-061901 -->
- No release step runs `changeset version` unguarded when there may be no pending changesets. <!-- @rule RL-6d16 discovered:rd-20261116-061901 -->
- Only one changelog generator is installed, and it is the one named in .changeset/config.json `changelog` (with a `repo` option if it is changelog-github). <!-- @rule RL-646e discovered:rd-20261116-061901 -->
