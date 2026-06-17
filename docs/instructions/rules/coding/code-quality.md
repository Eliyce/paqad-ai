# Code Quality

- Match the surrounding code's style, naming, and structure; read neighboring files before adding new ones.
- Keep functions small and single-purpose; avoid abstractions not required by the current change.
- Handle errors explicitly and propagate them with context; no silent catches.
- Do not leave dead code, commented-out blocks, or unused imports you introduced.
- Resolve any shared value (filesystem paths, runtime/package roots, config, clients) through the one canonical helper. Never re-derive or hand-copy that logic locally: a divergent copy is a latent bug that ships silently. If no helper exists, add one and route all callers through it. Before writing a path/root resolver, grep for an existing one.
- Avoid silent last-resort fallbacks (returning a guessed default when resolution fails, or treating an empty result as success). If a lookup that should yield results yields none, surface it as an error instead of degrading quietly.
