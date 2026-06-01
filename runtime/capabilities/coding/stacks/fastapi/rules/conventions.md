# FastAPI Conventions

- Define request and response bodies as Pydantic `BaseModel`s and set `response_model` on each route so output is validated and filtered; never return raw ORM objects from path operations without a schema.
- Group routes with `APIRouter` per resource and include them via `app.include_router(...)` with a `prefix` and `tags`; keep business logic in service functions, not in the endpoint body.
- Inject shared resources (DB session, current user, settings) with `Depends(...)`; do not instantiate database sessions or clients inline in handlers.
- Implement authentication/authorization as dependencies (e.g. `Depends(get_current_user)`) applied to routes or routers; enforce authorization on every protected endpoint.
- Use `async def` for handlers and dependencies that perform real `await` I/O; keep blocking/CPU-bound calls in `def` handlers (FastAPI runs them in a threadpool) so the event loop is never blocked.
- Declare path/query/header params with `Path`, `Query`, `Header` and validation constraints (`gt`, `max_length`, etc.) rather than validating by hand.
- Load configuration and secrets through a `pydantic-settings` `BaseSettings` object reading environment variables; never hardcode secrets or `SECRET_KEY`.
- Raise `HTTPException` (or register exception handlers) for error responses with the correct status code; do not return ad-hoc error dicts with a 200.
- Run database work through an ORM/parameterized queries (SQLAlchemy, SQLModel); never f-string user input into SQL.
- Offload long-running side effects to `BackgroundTasks` or a task queue (Celery/ARQ) instead of blocking the response.
- Use distinct input vs. output schemas (e.g. `UserCreate` vs. `UserRead`) so write-only fields like passwords are never serialized back to clients.
