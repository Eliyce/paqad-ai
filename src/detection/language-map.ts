import type { StackEcosystem } from '@/core/types/introspection.js';

/**
 * PQD-423: maps a toolchain {@link StackEcosystem} to a human-readable primary
 * language label for the detection report. Pure, side-effect-free, and total over
 * the closed `StackEcosystem` union.
 */
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

/**
 * Resolve the human-readable primary language for a detected ecosystem.
 *
 * @returns the language label, or `null` when no ecosystem was detected
 *   (`null`/`undefined`) or the ecosystem is not in the known map.
 */
export function ecosystemToLanguage(ecosystem: StackEcosystem | null | undefined): string | null {
  if (ecosystem === null || ecosystem === undefined) {
    return null;
  }
  return ECOSYSTEM_LANGUAGE[ecosystem] ?? null;
}
