# Flask Security Review Checklist

- Confirm `SECRET_KEY` and database credentials are not committed in app config.
- Review auth/session cookie settings and CSRF posture for browser forms.
- Validate all route inputs and confirm SQLAlchemy or raw SQL usage is parameterized.
- Check blueprint registration and debug configuration for unintended production exposure.
