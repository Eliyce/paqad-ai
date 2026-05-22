# Rails Security Review Checklist

- Validate `before_action` authentication and authorization callbacks on all sensitive controller actions.
- Check for mass-assignment exposure: confirm `permit` allowlists are minimal and correct.
- Review `config/credentials.yml.enc` and environment variable handling; secrets must not appear in logs.
- Confirm CSRF token verification is active; review `protect_from_forgery` exemptions.
- Check for N+1 and raw SQL exposure in ActiveRecord scopes and query methods.
