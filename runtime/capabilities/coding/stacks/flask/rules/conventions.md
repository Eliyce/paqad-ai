# Flask Conventions

- Keep the application factory, blueprint registration, and extension setup explicit and testable.
- Prefer blueprints for route grouping once the app grows beyond a single `app.py`.
- Store ORM models separately from request handlers and validate request data before it reaches model code.
- Treat template rendering and JSON APIs as separate surfaces with their own auth and output checks.
