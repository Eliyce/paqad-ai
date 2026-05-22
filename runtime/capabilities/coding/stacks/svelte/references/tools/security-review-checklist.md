# Svelte Security Review Checklist

- Validate SvelteKit server route authentication and `handle` hook for protected paths.
- Check for unsafe `{@html ...}` usage that could introduce XSS via unsanitized data.
- Review environment variable handling: `$env/static/private` must never be imported in client-side modules.
- Confirm form actions use CSRF protection and input validation before processing mutations.
- Check for sensitive data exposure in publicly accessible `+page.server.ts` `load` functions.
