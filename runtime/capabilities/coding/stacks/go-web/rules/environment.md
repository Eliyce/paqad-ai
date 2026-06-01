# Go Web Environment

- Resolve configuration into one typed config struct populated at startup (`os.Getenv` parsed once, or `envconfig`/`viper`), not ad-hoc `os.Getenv` calls scattered through handlers.
- Fail fast at startup when a required value is missing or unparseable: log the offending key and exit non-zero (`log.Fatal` / `os.Exit(1)`); do not start serving with a zero-value config.
- Keep real secrets out of the repo — load them from the environment or a secrets manager and commit only a `.env.example` with keys and empty values.
- Parse and validate types at load time (durations via `time.ParseDuration`, ints via `strconv.Atoi`) so the rest of the code consumes typed fields, not raw strings.
