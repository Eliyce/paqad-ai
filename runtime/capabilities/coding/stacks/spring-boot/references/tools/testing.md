# Spring Boot Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the full gate before merge.

## Common Commands (Maven)

- focused test: `./mvnw -Dtest=<ClassName> test`
- full suite: `./mvnw test`
- lint + verify: `./mvnw verify`
- if Docker Compose is active, prefix with `docker compose exec <jvm-service>`

## Common Commands (Gradle)

- focused test: `./gradlew test --tests "*<pattern>*"`
- full suite: `./gradlew test`
- lint + verify: `./gradlew check`

## Coverage Expectations

- cover happy path plus unauthorized, not-found, and validation-error responses that changed
- use `@WebMvcTest` for controller slices and `@DataJpaTest` for repository slices to keep test scope narrow
