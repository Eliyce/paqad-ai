# API Design

Loads when you add or change an API surface.

<!-- trigger: ** -->

- Make changes additive and backward-compatible; deprecate a field or endpoint before removing it, and version the surface when a break is unavoidable.
- Validate every request payload at the boundary, and reject unknown fields where the contract is closed.
- Document each endpoint's request shape, response shape, status codes, and error format together.
- Keep resource naming, pagination, and error envelopes consistent across endpoints.
