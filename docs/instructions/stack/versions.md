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

- `@huggingface/transformers ^3.8.0`
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
- `voyageai ^0.4.0`
- `yaml ^2.9.1`

## Root Package Build and Test Tools

- `tsup ^9.0.0`
- `typescript ^6.0.3`
- `vitest ^3.2.4`, `@vitest/coverage-v8 ^3.2.4`
- `eslint ^10.12.0`, `typescript-eslint ^8.71.2`
- `prettier ^3.9.10`

## graph-ui (SPA)

- `react ^19.0.0` (locked band)
- `tailwindcss ^4.0.0` (locked band)
- `vite ^6.4.3`
- `vitest ^5.0.5`, `@vitest/coverage-v8 5.0.5`

graph-ui runs Vitest 5 while the root package stays on Vitest 3.

## Notes

- Version bands tracked in `.paqad/project-profile.yaml › stack_profile.version_bands`.
- Lockfiles: root `pnpm-lock.yaml`, `graph-ui/pnpm-lock.yaml`. pnpm is the only package manager.
- Update with `pnpm up <pkg>` and refresh the stack snapshot via the framework.
