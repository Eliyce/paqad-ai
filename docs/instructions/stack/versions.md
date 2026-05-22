# Locked Stack Versions

Source: `package.json`, `graph-ui/package.json`, `.paqad/stack-snapshot.json`.

## Runtime

| Component  | Range / Locked                      |
|------------|-------------------------------------|
| Node       | `>=22.0.0`                          |
| TypeScript | (devDep — see `package.json`)       |
| pnpm       | repository-pinned (root + graph-ui) |

## Root Package — Production

- `@inquirer/prompts ^7.3.3`
- `@xenova/transformers ^2.17.2`
- `ajv ^8.17.1`
- `chalk ^5.4.1`
- `commander ^14.0.1`
- `execa ^9.6.0`
- `fast-glob ^3.3.3`
- `handlebars ^4.7.8`
- `openai ^6.33.0`
- `ora ^8.2.0`
- `pathe ^2.0.3`
- `voyageai ^0.2.1`
- `yaml ^2.8.1`

## graph-ui (SPA)

- `react ^19.0.0` (locked band)
- `tailwindcss ^4.0.0` (locked band)
- Vite, Vitest — see `graph-ui/package.json`

## Notes

- Version bands tracked in `.paqad/project-profile.yaml › stack_profile.version_bands`.
- Lockfiles: root `pnpm-lock.yaml`, `graph-ui/pnpm-lock.yaml`. `package-lock.json` files also exist but pnpm is
  canonical.
- Update with `pnpm up <pkg>` and refresh the stack snapshot via the framework.
