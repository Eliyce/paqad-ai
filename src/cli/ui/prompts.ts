import { checkbox, confirm, input, select } from '@inquirer/prompts';

export async function confirmPrompt(message: string): Promise<boolean> {
  return confirm({ message });
}

export async function selectPrompt(
  message: string,
  choices: Array<{ name: string; value: string }>,
): Promise<string> {
  return select({ message, choices });
}

export async function checkboxPrompt<T>(
  message: string,
  choices: Array<{ name: string; value: T; checked?: boolean }>,
): Promise<T[]> {
  return checkbox({ message, choices });
}

/* v8 ignore next 3 -- exported UI helper; not exercised in unit tests */
export async function inputPrompt(message: string, defaultValue?: string): Promise<string> {
  return input({ message, default: defaultValue });
}
