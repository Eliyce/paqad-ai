# Flutter Environment Loading Guide

Use one environment-loading approach project-wide and expose configuration through typed wrappers.

## Recommended Patterns

- `envied` for compile-time typed values
- `flutter_dotenv` for runtime-loaded environment files

## Rules

- resolve environment values during bootstrap
- inject typed config into services, state, and repositories
- do not read raw environment keys inside widgets
- map flavors explicitly to config sources and fail fast on missing required keys
