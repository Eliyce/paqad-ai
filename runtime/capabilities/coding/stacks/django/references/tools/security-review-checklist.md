# Django Security Review Checklist

- Validate view-level permission checks and authentication decorators on sensitive endpoints.
- Check for SQL injection exposure in raw querysets and ORM `extra()` or `RawSQL()` calls.
- Review `ALLOWED_HOSTS`, `DEBUG`, and `SECRET_KEY` handling in settings and environment loading.
- Confirm CSRF protection is active for state-changing views; verify exemptions are intentional.
- Check file upload handling for path traversal and MIME type validation.
