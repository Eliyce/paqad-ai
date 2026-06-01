# Flutter Architecture

- Module ownership and boundaries are defined per-project in `docs/instructions/rules/module-map.yml` — treat that file as the source of truth for which feature owns which directory, and do not duplicate or contradict it here.
- Keep `build` methods free of business logic, I/O, and network calls; widgets compose UI and delegate to a controller/notifier (`ChangeNotifier`, `Cubit`/`Bloc`, Riverpod provider) or a service/repository class.
- Do not parse JSON, map DTOs, and render widgets in the same file — keep transport models (`fromJson`/`toJson`) and domain models separate.
- Define routes once with a typed router (`go_router` `GoRoute` or the project's router config); never construct `MaterialPageRoute` ad hoc inside widgets with hard-coded string paths.
