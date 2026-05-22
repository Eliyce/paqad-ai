# Next.js Security Review Checklist

- Validate all Server Action inputs with a schema before processing.
- Review middleware matchers and auth bypass paths.
- Confirm server-only data is not passed into client components or serialized into public props.
- Check API routes for CSRF, auth, and rate limiting where applicable.
