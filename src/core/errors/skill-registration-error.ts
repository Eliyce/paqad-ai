import { FrameworkError } from './framework-error.js';

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
  builtInId?: string;
  runtimeId?: string;
  cause?: unknown;
}

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
