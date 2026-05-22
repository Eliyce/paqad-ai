# Go Web Foundation

- Prefer standard library and well-established packages over custom scaffolding.
- Keep handlers thin: parse and validate input, delegate to a service or domain layer, write the response.
- Use `context.Context` as the first argument of every function that does I/O or can be cancelled.
- Keep package boundaries intentional — one package per coherent responsibility, no circular imports.
