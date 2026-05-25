import { detectDeliveryHost, parseOwnerRepo } from '@/delivery/host.js';

describe('delivery host detection', () => {
  it('detects GitHub from ssh and https remotes', () => {
    expect(detectDeliveryHost('git@github.com:Eliyce/paqad-ai.git')).toBe('github');
    expect(detectDeliveryHost('https://github.com/Eliyce/paqad-ai.git')).toBe('github');
  });

  it('detects GitLab and Bitbucket including self-hosted subdomains', () => {
    expect(detectDeliveryHost('git@gitlab.com:org/repo.git')).toBe('gitlab');
    expect(detectDeliveryHost('https://gitlab.acme.internal/org/repo.git')).toBe('gitlab');
    expect(detectDeliveryHost('https://bitbucket.org/org/repo')).toBe('bitbucket');
  });

  it('returns unknown for empty/unknown remotes', () => {
    expect(detectDeliveryHost(null)).toBe('unknown');
    expect(detectDeliveryHost('')).toBe('unknown');
    expect(detectDeliveryHost('git@example.net:org/repo.git')).toBe('unknown');
  });

  it('parses owner/repo from ssh and https remotes', () => {
    expect(parseOwnerRepo('git@github.com:Eliyce/paqad-ai.git')).toEqual({
      owner: 'Eliyce',
      repo: 'paqad-ai',
    });
    expect(parseOwnerRepo('https://github.com/Eliyce/paqad-ai')).toEqual({
      owner: 'Eliyce',
      repo: 'paqad-ai',
    });
    expect(parseOwnerRepo('https://github.com/Eliyce/paqad-ai.git/')).toEqual({
      owner: 'Eliyce',
      repo: 'paqad-ai',
    });
  });

  it('returns null for unrecognised remote shapes', () => {
    expect(parseOwnerRepo(null)).toBeNull();
    expect(parseOwnerRepo('not-a-url')).toBeNull();
  });
});
