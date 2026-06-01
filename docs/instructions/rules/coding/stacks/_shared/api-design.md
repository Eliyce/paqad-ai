# API Design

- Prefer additive, backward-compatible changes; deprecate before removing a field or endpoint, and version when a break is unavoidable.
- Validate every request payload at the boundary and reject unknown fields where the contract is closed.
- Document request shape, response shape, status codes, and error format together for each endpoint.
- Keep resource naming, pagination, and error envelopes consistent across endpoints.
