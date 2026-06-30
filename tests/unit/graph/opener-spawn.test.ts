import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Covers openBrowser's actual spawn path (per-OS command + try/catch), which the
// sibling opener.test.ts can't exercise without launching a real browser. spawn and
// platform are mocked so no process is ever started.
const { mockSpawn, mockPlatform } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockPlatform: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: mockSpawn }));
vi.mock('node:os', () => ({ platform: mockPlatform }));

import { openBrowser } from '@/graph/opener';

function fakeChild() {
  return { on: vi.fn(), unref: vi.fn() };
}

describe('openBrowser spawn paths', () => {
  let savedSsh: string | undefined;
  let savedConn: string | undefined;
  let savedDisplay: string | undefined;
  let savedWayland: string | undefined;

  beforeEach(() => {
    // Neutralise any ambient skip signals so the spawn path is reached.
    savedSsh = process.env.SSH_TTY;
    savedConn = process.env.SSH_CONNECTION;
    savedDisplay = process.env.DISPLAY;
    savedWayland = process.env.WAYLAND_DISPLAY;
    delete process.env.SSH_TTY;
    delete process.env.SSH_CONNECTION;
    process.env.DISPLAY = ':0';
    delete process.env.WAYLAND_DISPLAY;
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (savedSsh === undefined) delete process.env.SSH_TTY;
    else process.env.SSH_TTY = savedSsh;
    if (savedConn === undefined) delete process.env.SSH_CONNECTION;
    else process.env.SSH_CONNECTION = savedConn;
    if (savedDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = savedDisplay;
    if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY;
    else process.env.WAYLAND_DISPLAY = savedWayland;
  });

  it('spawns `open` on darwin', () => {
    mockPlatform.mockReturnValue('darwin');
    mockSpawn.mockReturnValue(fakeChild());
    expect(openBrowser({ url: 'http://x' })).toEqual({ opened: true });
    expect(mockSpawn).toHaveBeenCalledWith('open', ['http://x'], expect.anything());
  });

  it('spawns `cmd start` on win32', () => {
    mockPlatform.mockReturnValue('win32');
    mockSpawn.mockReturnValue(fakeChild());
    openBrowser({ url: 'http://x' });
    expect(mockSpawn).toHaveBeenCalledWith(
      'cmd',
      ['/c', 'start', '""', 'http://x'],
      expect.anything(),
    );
  });

  it('spawns `xdg-open` on linux when a display is present', () => {
    mockPlatform.mockReturnValue('linux');
    mockSpawn.mockReturnValue(fakeChild());
    openBrowser({ url: 'http://x' });
    expect(mockSpawn).toHaveBeenCalledWith('xdg-open', ['http://x'], expect.anything());
  });

  it('reports the error reason when spawn throws', () => {
    mockPlatform.mockReturnValue('darwin');
    mockSpawn.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(openBrowser({ url: 'http://x' })).toEqual({ opened: false, reason: 'boom' });
  });

  it('skips without spawning on a headless linux host', () => {
    delete process.env.DISPLAY;
    mockPlatform.mockReturnValue('linux');
    const result = openBrowser({ url: 'http://x' });
    expect(result.opened).toBe(false);
    expect(result.reason).toMatch(/display/);
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
