# Express Security Review Checklist

- Validate authentication middleware is applied to all protected route groups; check for missing `app.use` ordering issues.
- Review `helmet` configuration: confirm CSP, HSTS, and X-Frame-Options are set appropriately.
- Check for prototype pollution and injection exposure in body-parser input paths.
- Confirm environment variables are loaded via `dotenv` or equivalent and secrets are not hardcoded.
- Review CORS `origin` option: ensure it is not set to `true` (mirrors all origins) in production.
