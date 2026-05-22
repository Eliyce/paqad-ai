# Vue Security Review Checklist

- Validate route protection and privileged action coverage in docs and tests.
- Check runtime surfaces such as debug paths, admin routes, and sensitive-file exposure.
- Review workflow-state docs for replay, duplicate action, and bypass scenarios.
- Confirm secrets and server-only configuration stay out of client bundles.
