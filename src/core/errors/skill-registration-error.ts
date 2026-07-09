import { FrameworkError } from './framework-error.js';

/** Why a runtime skill registration or removal was refused. */
export type SkillRegistrationErrorKind =
  'malformed' | 'duplicate' | 'not-found' | 'built-in-protected';

const CODE_BY_KIND: Record<SkillRegistrationErrorKind, string> = {
  malformed: 'SKILL_MALFORMED',
  duplicate: 'SKILL_DUPLICATE',
  'not-found': 'SKILL_NOT_FOUND',
  'built-in-protected': 'SKILL_BUILTIN_PROTECTED',
};

export interface SkillRegistrationErrorOptions {
  kind: SkillRegistrationErrorKind;
  /** Built-in skill identifier involved in a `duplicate` collision. */
  builtInId?: string;
  /** Runtime skill identifier involved in a `duplicate` collision. */
  runtimeId?: string;
  cause?: unknown;
}

/**
 * Stable, named error for runtime skill registration/removal failures, so a
 * consumer (e.g. an in-app skill editor) can `instanceof`-check and branch on
 * `kind`. The `duplicate` case carries both colliding identifiers.
 */
export class SkillRegistrationError extends FrameworkError {
  readonly kind: SkillRegistrationErrorKind;
  readonly builtInId?: string;
  readonly runtimeId?: string;

  constructor(message: string, options: SkillRegistrationErrorOptions) {
    super(message, {
      code: CODE_BY_KIND[options.kind],
      cause: options.cause,
      details: { kind: options.kind, builtInId: options.builtInId, runtimeId: options.runtimeId },
    });
    this.name = 'SkillRegistrationError';
    this.kind = options.kind;
    this.builtInId = options.builtInId;
    this.runtimeId = options.runtimeId;
  }
}
