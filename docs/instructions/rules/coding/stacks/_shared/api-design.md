# API Design

- Prefer additive, backward-compatible changes; deprecate before removing a field or endpoint, and version when a break is unavoidable. <!-- @rule RL-8b30 -->
- Validate every request payload at the boundary and reject unknown fields where the contract is closed. <!-- @rule RL-d041 -->
- Document request shape, response shape, status codes, and error format together for each endpoint. <!-- @rule RL-72a8 -->
- Keep resource naming, pagination, and error envelopes consistent across endpoints. <!-- @rule RL-04c4 -->
