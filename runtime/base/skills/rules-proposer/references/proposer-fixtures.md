# Proposer fixtures

The fixed example pairs the proposer is checked against. Each row gives an idea, an existing rule and the expected outcome.

| Idea                                               | Existing rule                                  | Outcome  |
| -------------------------------------------------- | ---------------------------------------------- | -------- |
| Validate request bodies at the route boundary.     | Validate request bodies at the route boundary. | fold     |
| Check every request body with zod before handlers. | Validate request bodies at the route boundary. | fold     |
| Return errors as plain text.                       | Return errors as problem+json.                 | conflict |
| Use `Date` objects, never moment.                  | Use moment for every date calculation.         | conflict |
| Parse untrusted input with zod schemas.            | Return errors as problem+json.                 | new      |
| Log every request with a request id.               | Validate request bodies at the route boundary. | new      |
| Name test files `<unit>.test.ts`.                  | Put tests beside the code they cover.          | new      |
