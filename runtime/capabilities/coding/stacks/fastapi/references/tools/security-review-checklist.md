# FastAPI Security Review Checklist

- Validate dependency-injected auth on all protected routes; check for missing `Depends(get_current_user)`.
- Review Pydantic model validators for input sanitization and type coercion edge cases.
- Check CORS middleware origins and ensure wildcard `*` is not used in production configs.
- Confirm sensitive fields are excluded from response schemas (`response_model_exclude`).
- Review background tasks for proper error isolation so they do not swallow auth or permission failures.
