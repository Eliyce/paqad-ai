# Design-test helper skills by step

Which helper skill runs at which step of the Procedure. Each helper keeps its own checks and procedure; this skill gathers the output.

| Step                  | Helper skills                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 readiness-gate      | `design-system-coverage`                                                                                                                                                               |
| 1 collect-context     | `token-conformance-review`, `component-conformance-review`, `state-coverage-review`, `accessibility-review`, `responsive-review`, `motion-review`, `copy-and-ia-review`, in this order |
| 3 live-validation     | `accessibility-review`, `responsive-review`, `motion-review`, `state-coverage-review`                                                                                                  |
| 4 synthesize-findings | `finding-normalizer`                                                                                                                                                                   |
