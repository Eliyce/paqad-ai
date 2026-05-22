export function buildRunnerScriptContext(input: {
  projectName: string;
  commands: {
    test: string;
    lint: string;
    format: string;
  };
  stack?: string;
  routing?: {
    stack?: string;
  };
}) {
  const stack = input.stack ?? input.routing?.stack ?? 'unknown';

  return {
    ...input,
    routing: {
      stack,
    },
  };
}
