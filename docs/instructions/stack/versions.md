# Locked Stack Versions

Source: `package.json`, `graph-ui/package.json`, `.paqad/stack-snapshot.json`.

## Runtime

| Component  | Range / Locked                                                    |
|------------|-------------------------------------------------------------------|
| Node       | `>=22.0.0` to install and run (published `engines`)               |
| Node build | 22.18 or later (24.11 or later on Node 24), pinned in `.nvmrc`    |
| TypeScript | `^6.0.3` (root devDep), `^5.9.0` (graph-ui)                       |
| pnpm       | `pnpm@10.17.1` (`packageManager`), root + graph-ui                |

Building from source needs Node 22.18 or later (24.11 or later on Node 24) because tsup 9
needs it to run. The published `engines` field stays `>=22.0.0`, because installing and
running the package is unaffected.

## Root Package — Production

- `@huggingface/transformers ^4.3.1` (pipelines pinned to `dtype: 'q8'`)
- `@inquirer/prompts ^8.7.3`
- `ajv ^8.20.0`
- `chalk ^6.0.1`
- `commander ^15.0.0`
- `execa ^10.1.1`
- `fast-glob ^3.3.3`
- `gifenc 1.0.3`
- `handlebars ^4.7.10`
- `openai ^7.34.0`
- `ora ^9.4.1`
- `pathe ^2.0.3`
- `yaml ^2.9.1`

## Root Package Build and Test Tools

- `tsup ^9.0.0`
- `typescript ^6.0.3`
- `vitest ^5.0.5`, `@vitest/coverage-v8 ^5.0.5`
- `eslint ^10.12.0`, `typescript-eslint ^8.71.2`
- `prettier ^3.9.10`
- `markdownlint-cli2 ^0.24.0`

`pnpm.overrides` holds floors for dev-only packages, each capped below the next major (for
example `vite >=7.3.7 <8`). No shipped runtime fix relies on an override.
`pnpm.auditConfig.ignoreGhsas` lists the one advisory the CI audit step ignores, by GHSA id.

## graph-ui (SPA)

- `react ^19.0.0` (locked band)
- `tailwindcss ^4.0.0` (locked band)
- `vite ^6.4.6`
- `vitest ^5.0.5`, `@vitest/coverage-v8 5.0.5`

The root package and graph-ui both run Vitest 5.

## Notes

- Version bands tracked in `.paqad/project-profile.yaml › stack_profile.version_bands`.
- Lockfiles: root `pnpm-lock.yaml`, `graph-ui/pnpm-lock.yaml`. pnpm is the only package manager.
- Update with `pnpm up <pkg>` and refresh the stack snapshot via the framework.

<!-- paqad:stack:versions:start -->
| Package | Ecosystem | Declared | Installed | Dev |
| --- | --- | --- | --- | --- |
| @changesets/changelog-git | node | ^0.2.1 | 0.2.1 | yes |
| @changesets/changelog-github | node | ^1.0.1 | 1.0.1 | yes |
| @changesets/cli | node | ^3.0.3 | 3.0.3 | yes |
| @codemirror/lang-markdown | node | ^6.5.0 | 6.5.0 | no |
| @codemirror/lang-yaml | node | ^6.1.3 | 6.1.3 | no |
| @codemirror/state | node | ^6.6.0 | 6.6.0 | no |
| @codemirror/view | node | ^6.43.1 | 6.43.1 | no |
| @dagrejs/dagre | node | ^3.1.1 | 3.1.1 | no |
| @eslint/js | node | ^10.0.1 | 10.0.1 | yes |
| @huggingface/transformers | node | ^4.3.2 | 4.3.2 | no |
| @inquirer/prompts | node | ^8.7.5 | 8.7.5 | no |
| @tailwindcss/vite | node | ^4.0.0 | 4.3.0 | yes |
| @types/node | node | ^26.6.6 | 26.6.6 | yes |
| @types/react | node | ^19.0.0 | 19.2.15 | yes |
| @types/react-dom | node | ^19.0.0 | 19.2.3 | yes |
| @vitejs/plugin-react | node | ^4.3.0 | 4.7.0 | yes |
| @vitest/coverage-v8 | node | 5.0.5 | 5.0.5 | yes |
| @vitest/coverage-v8 | node | ^5.1.0 | 5.1.0 | yes |
| @xyflow/react | node | ^12.11.3 | 12.11.3 | no |
| ajv | node | ^8.20.0 | 8.20.0 | no |
| chalk | node | ^6.0.1 | 6.0.1 | no |
| cmdk | node | ^1.1.1 | 1.1.1 | no |
| codemirror | node | ^6.0.2 | 6.0.2 | no |
| commander | node | ^15.0.0 | 15.0.0 | no |
| eslint | node | ^10.14.0 | 10.14.0 | yes |
| execa | node | ^10.2.1 | 10.2.1 | no |
| fast-glob | node | ^3.3.3 | 3.3.3 | no |
| gifenc | node | 1.0.3 | 1.0.3 | no |
| globals | node | ^17.14.0 | 17.14.0 | yes |
| graphology | node | ^0.25.4 | 0.25.4 | no |
| graphology-layout-forceatlas2 | node | ^0.10.1 | 0.10.1 | no |
| handlebars | node | ^4.7.10 | 4.7.10 | no |
| markdownlint-cli2 | node | ^0.24.0 | 0.24.0 | yes |
| marked | node | ^18.0.5 | 18.0.5 | no |
| minimatch | node | ^11.0.5 | 11.0.5 | no |
| openai | node | ^7.52.0 | 7.52.0 | no |
| ora | node | ^10.0.0 | 10.0.0 | no |
| pathe | node | ^2.0.3 | 2.0.3 | no |
| prettier | node | ^3.9.10 | 3.9.10 | yes |
| react | node | ^19.0.0 | 19.2.6 | no |
| react-dom | node | ^19.0.0 | 19.2.6 | no |
| sigma | node | ^3.0.0 | 3.0.3 | no |
| tailwindcss | node | ^4.0.0 | 4.3.0 | yes |
| tsup | node | ^9.0.0 | 9.0.0 | yes |
| typescript | node | ^5.9.0 | 5.9.3 | yes |
| typescript | node | ^6.0.3 | 6.0.3 | yes |
| typescript-eslint | node | ^8.72.1 | 8.72.1 | yes |
| vite | node | ^6.4.5 | 6.4.5 | yes |
| vitest | node | ^5.0.5 | 5.0.5 | yes |
| vitest | node | ^5.1.0 | 5.1.0 | yes |
| yaml | node | ^2.9.0 | 2.9.0 | no |
| yaml | node | ^2.9.1 | 2.9.1 | no |
| zustand | node | ^5.0.0 | 5.0.13 | no |
<!-- paqad:stack:versions:end -->
