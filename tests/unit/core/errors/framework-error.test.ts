import { FrameworkError, ResolutionError, ValidationError } from '@/core/errors';

describe('framework errors', () => {
  it('captures framework error metadata', () => {
    const error = new FrameworkError('boom', {
      code: 'FRAMEWORK_ERROR',
      details: { phase: 'phase-1' },
    });

    expect(error.name).toBe('FrameworkError');
    expect(error.code).toBe('FRAMEWORK_ERROR');
    expect(error.details).toEqual({ phase: 'phase-1' });
  });

  it('specializes validation and resolution errors', () => {
    const validation = new ValidationError('invalid profile', {
      field: 'routing.stack',
    });
    const resolution = new ResolutionError('missing artifact', {
      artifact: 'rules',
    });

    expect(validation.code).toBe('VALIDATION_ERROR');
    expect(resolution.code).toBe('RESOLUTION_ERROR');
  });
});
