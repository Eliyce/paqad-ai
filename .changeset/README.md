# Changesets

This folder is managed by `@changesets/cli`.

## Adding a changeset

Whenever you make a user-facing change to `paqad-ai`, run:

```bash
pnpm changeset
```

You will be prompted to:

1. Select the type of bump (`patch`, `minor`, or `major`).
2. Write a short, user-facing summary of the change.

Commit the resulting markdown file as part of your PR. On merge to `main`, the
changesets bot aggregates all pending changesets into a single "Version Packages"
pull request. Merging that PR publishes a new version to npm.

## When to add one

| Change type                              | Bump  |
| ---------------------------------------- | ----- |
| Bug fix affecting runtime behavior       | patch |
| New CLI flag, new option, new stack pack | minor |
| Backwards-incompatible API or CLI change | major |
| Docs, tests, internal refactor only      | none  |

When in doubt, add one — a reviewer can downgrade or remove it before merge.

## Further reading

- <https://github.com/changesets/changesets>
- <https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md>
