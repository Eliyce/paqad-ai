import type { StackEcosystem } from '@/core/types/introspection.js';

const ECOSYSTEM_LANGUAGE: Record<StackEcosystem, string> = {
  node: 'JavaScript/TypeScript',
  php: 'PHP',
  python: 'Python',
  ruby: 'Ruby',
  jvm: 'Java/Kotlin',
  go: 'Go',
  rust: 'Rust',
  dart: 'Dart',
};

export function ecosystemToLanguage(ecosystem: StackEcosystem | null | undefined): string | null {
  if (ecosystem === null || ecosystem === undefined) {
    return null;
  }
  return ECOSYSTEM_LANGUAGE[ecosystem] ?? null;
}
