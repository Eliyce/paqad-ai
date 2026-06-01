# Django Conventions

- Keep views thin: put query logic on model managers/`QuerySet` methods and multi-step business logic in a `services.py` (or domain) layer, not in view bodies.
- Eliminate N+1 queries with `select_related` (forward FK/one-to-one) and `prefetch_related` (reverse FK/many-to-many); audit hot paths with `assertNumQueries` or `django-debug-toolbar`.
- Change models only through migrations: run `makemigrations` then `migrate`, commit the generated migration files, and never edit applied migrations in place.
- In Django REST Framework, validate and shape every request/response through serializers (`ModelSerializer` or `Serializer`); do not build response dicts by hand or trust raw `request.data`.
- Enforce object-level access with DRF permission classes / `get_queryset` filtering by `request.user`; never expose a queryset that ignores the current user's scope.
- Keep `SECRET_KEY`, database credentials, and `DEBUG` out of source — read them from environment variables, and ensure `DEBUG = False` with a real `ALLOWED_HOSTS` in production.
- Preserve CSRF protection for session-authenticated form/AJAX POSTs; only exempt endpoints that use a stateless auth scheme (e.g. token/JWT), and never blanket-apply `@csrf_exempt`.
- Use the ORM with parameterized queries; if you must drop to raw SQL, use `params=[...]` (or `cursor.execute(sql, params)`), never f-strings or `%`-interpolated values.
- Offload slow or external work to Celery (or `django-rq`) tasks rather than blocking the request; do not call external APIs synchronously in a view.
- Wrap multi-write operations in `transaction.atomic()` so partial failures roll back.
- Define URL routes with named patterns and reverse them with `reverse()`/`{% url %}`; do not hardcode paths.
- Use `settings.AUTH_USER_MODEL`/`get_user_model()` rather than importing `django.contrib.auth.models.User` directly.
