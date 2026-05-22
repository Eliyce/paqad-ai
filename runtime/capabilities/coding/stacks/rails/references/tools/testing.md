# Rails Testing Guide

Use the narrowest command that proves the changed behavior, then expand to the full gate before merge.

## Common Commands

- focused test: `bundle exec rspec <path_or_file>`
- full suite: `bundle exec rspec`
- lint: `bundle exec rubocop`
- if Docker Compose is active, prefix with `docker compose exec <ruby-service>`

## Coverage Expectations

- cover happy path plus authentication-required and validation-failure states that changed
- include request specs for new API endpoints and system specs for critical user flows
