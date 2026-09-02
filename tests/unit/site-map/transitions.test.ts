import { describe, expect, it } from 'vitest';

import type { AppMap, Surface } from '@/core/types/site-map.js';
import { validateAppMap } from '@/site-map/schema.js';
import {
  attachResolvedTransitions,
  buildUnresolvedLinksCheck,
  detectLaravelTransitions,
  detectNodeCliTransitions,
  detectReactRouterTransitions,
  resolveTransitions,
  type ExtractedTransition,
  type TransitionSourceRecord,
} from '@/site-map/transitions.js';

function record(
  content: string,
  overrides: Partial<TransitionSourceRecord> = {},
): TransitionSourceRecord {
  return {
    from_raw_id: 'laravel-routes-get-dashboard',
    file: 'app/Http/Controllers/DashboardController.php',
    content,
    ...overrides,
  };
}

/** Sort by (trigger, to_target) so an assertion does not depend on detector concat order. */
function sorted(transitions: ExtractedTransition[]): ExtractedTransition[] {
  return [...transitions].sort(
    (a, b) => a.trigger.localeCompare(b.trigger) || a.to_target.localeCompare(b.to_target),
  );
}

describe('site-map transitions', () => {
  describe('detectLaravelTransitions', () => {
    it('records each framework navigation call, high-confidence, with resolving evidence', () => {
      const content = [
        "        return redirect()->route('dashboard');", // line 1
        "        return redirect('/home');", // line 2
        "        return to_route('profile.edit');", // line 3
        "        return Inertia::render('Users/Index');", // line 4
      ].join('\n');
      const transitions = detectLaravelTransitions([record(content)]);

      expect(sorted(transitions)).toEqual([
        {
          from_raw_id: 'laravel-routes-get-dashboard',
          to_target: '/home',
          trigger: 'redirect',
          evidence: [{ file: record('').file, line: 2 }],
          confidence: 'high',
        },
        {
          from_raw_id: 'laravel-routes-get-dashboard',
          to_target: 'dashboard',
          trigger: 'redirect',
          evidence: [{ file: record('').file, line: 1 }],
          confidence: 'high',
        },
        {
          from_raw_id: 'laravel-routes-get-dashboard',
          to_target: 'profile.edit',
          trigger: 'redirect',
          evidence: [{ file: record('').file, line: 3 }],
          confidence: 'high',
        },
        {
          from_raw_id: 'laravel-routes-get-dashboard',
          to_target: 'Users/Index',
          trigger: 'render',
          evidence: [{ file: record('').file, line: 4 }],
          confidence: 'high',
        },
      ]);
    });

    it("records view('name') as a low-confidence render (a convention-based match)", () => {
      const [only] = detectLaravelTransitions([record("        return view('welcome');")]);
      expect(only).toEqual({
        from_raw_id: 'laravel-routes-get-dashboard',
        to_target: 'welcome',
        trigger: 'render',
        evidence: [{ file: record('').file, line: 1 }],
        confidence: 'low',
      });
    });

    it('does not record a bare route() URL build or a lookalike path string (negative fixture)', () => {
      // route() alone builds a URL (no navigation); a lone path literal is just a string.
      const content = ["        $url = route('dashboard');", "        $path = '/checkout';"].join(
        '\n',
      );
      expect(detectLaravelTransitions([record(content)])).toEqual([]);
    });
  });

  describe('detectReactRouterTransitions', () => {
    it('records navigate(), <Link to>, and <Navigate to> as high-confidence edges', () => {
      const content = [
        '  const navigate = useNavigate();', // line 1: a hook call, not navigation
        "  navigate('/checkout');", // line 2
        '  return <Link className="btn" to="/cart">Cart</Link>;', // line 3
        '  return <Navigate to="/login" replace />;', // line 4
      ].join('\n');
      const transitions = detectReactRouterTransitions([
        record(content, { from_raw_id: 'react-routes-checkout', file: 'src/pages/Checkout.tsx' }),
      ]);

      expect(sorted(transitions)).toEqual([
        {
          from_raw_id: 'react-routes-checkout',
          to_target: '/cart',
          trigger: 'link',
          evidence: [{ file: 'src/pages/Checkout.tsx', line: 3 }],
          confidence: 'high',
        },
        {
          from_raw_id: 'react-routes-checkout',
          to_target: '/checkout',
          trigger: 'navigate',
          evidence: [{ file: 'src/pages/Checkout.tsx', line: 2 }],
          confidence: 'high',
        },
        {
          from_raw_id: 'react-routes-checkout',
          to_target: '/login',
          trigger: 'redirect',
          evidence: [{ file: 'src/pages/Checkout.tsx', line: 4 }],
          confidence: 'high',
        },
      ]);
    });

    it('does not record a bare <a href> (negative fixture)', () => {
      const transitions = detectReactRouterTransitions([
        record('  return <a href="/home">Home</a>;', { from_raw_id: 'react-routes-home' }),
      ]);
      expect(transitions).toEqual([]);
    });
  });

  describe('detectNodeCliTransitions', () => {
    it('records a command dispatching another command as a low-confidence invoke', () => {
      const [only] = detectNodeCliTransitions([
        record("    await runCommand('index build');", {
          from_raw_id: 'node-cli-sitemap-run',
          file: 'src/cli/commands/sitemap.ts',
        }),
      ]);
      expect(only).toEqual({
        from_raw_id: 'node-cli-sitemap-run',
        to_target: 'index build',
        trigger: 'invoke',
        evidence: [{ file: 'src/cli/commands/sitemap.ts', line: 1 }],
        confidence: 'low',
      });
    });

    it('does not record a command declaration or a description mention (negative fixture)', () => {
      const content = [
        "  program.command('build');", // a declaration, not an invocation
        "  console.log('run the build command');", // a mention in a string
      ].join('\n');
      expect(detectNodeCliTransitions([record(content)])).toEqual([]);
    });
  });

  describe('resolveTransitions (S9b)', () => {
    function surface(id: string, entryValue?: string): Surface {
      return {
        id,
        kind: 'page',
        label: id,
        ...(entryValue === undefined ? {} : { entry: { kind: 'url', value: entryValue } }),
      };
    }

    function transition(overrides: Partial<ExtractedTransition>): ExtractedTransition {
      return {
        from_raw_id: 'from',
        to_target: '/target',
        trigger: 'navigate',
        evidence: [{ file: 'src/from.tsx', line: 4 }],
        confidence: 'high',
        ...overrides,
      };
    }

    it('resolves a target by route name, by URL path, and by command name (AC-1)', () => {
      const surfaces = [
        surface('laravel-routes-get-dashboard', 'dashboard'), // a route name
        surface('react-routes-cart', '/cart'), // a URL path
        surface('node-cli-index-build', 'index build'), // a command name
      ];
      const transitions = [
        transition({ from_raw_id: 'a', to_target: 'dashboard', trigger: 'redirect' }),
        transition({ from_raw_id: 'b', to_target: '/cart', trigger: 'link' }),
        transition({
          from_raw_id: 'c',
          to_target: 'index build',
          trigger: 'invoke',
          confidence: 'low',
          evidence: [{ file: 'src/cli.ts', line: 9 }],
        }),
      ];

      const { resolved, dropped } = resolveTransitions(transitions, surfaces);

      expect(dropped).toBe(0);
      expect(resolved).toEqual([
        {
          from_id: 'a',
          transition: {
            to: 'laravel-routes-get-dashboard',
            trigger: 'redirect',
            evidence: [{ file: 'src/from.tsx', line: 4 }],
            confidence: 'high',
          },
        },
        {
          from_id: 'b',
          transition: {
            to: 'react-routes-cart',
            trigger: 'link',
            evidence: [{ file: 'src/from.tsx', line: 4 }],
            confidence: 'high',
          },
        },
        {
          from_id: 'c',
          transition: {
            to: 'node-cli-index-build',
            trigger: 'invoke',
            evidence: [{ file: 'src/cli.ts', line: 9 }],
            confidence: 'low',
          },
        },
      ]);
    });

    it('drops and counts a target that matches no surface, never guessing (AC-2)', () => {
      const surfaces = [surface('react-routes-cart', '/cart')];
      const { resolved, dropped } = resolveTransitions(
        [
          transition({ to_target: '/cart' }),
          transition({ to_target: '/nowhere' }), // no surface carries this entry
        ],
        surfaces,
      );
      expect(dropped).toBe(1);
      expect(resolved).toHaveLength(1);
      expect(resolved[0]!.transition.to).toBe('react-routes-cart');
    });

    it('ignores surfaces with no entry and keeps the first surface for a shared entry value', () => {
      const surfaces = [
        surface('no-entry'), // never a resolution target
        surface('first', '/dup'),
        surface('second', '/dup'), // same entry.value — first wins
      ];
      const { resolved, dropped } = resolveTransitions(
        [transition({ to_target: '/dup' })],
        surfaces,
      );
      expect(dropped).toBe(0);
      expect(resolved[0]!.transition.to).toBe('first');
    });
  });

  describe('attachResolvedTransitions (S9b)', () => {
    const base: Surface[] = [
      { id: 'home', kind: 'page', label: 'Home' },
      { id: 'cart', kind: 'page', label: 'Cart' },
      {
        id: 'checkout',
        kind: 'page',
        label: 'Checkout',
        transitions: [{ to: 'home', trigger: 'link' }],
      },
    ];

    it('appends resolved edges to their origin surfaces and leaves the rest untouched (AC-4)', () => {
      const attached = attachResolvedTransitions(base, [
        {
          from_id: 'home',
          transition: {
            to: 'cart',
            trigger: 'link',
            evidence: [{ file: 'a.tsx', line: 2 }],
            confidence: 'high',
          },
        },
        {
          from_id: 'checkout',
          transition: {
            to: 'cart',
            trigger: 'navigate',
            evidence: [{ file: 'b.tsx', line: 3 }],
            confidence: 'high',
          },
        },
      ]);

      expect(attached.find((s) => s.id === 'home')!.transitions).toEqual([
        { to: 'cart', trigger: 'link', evidence: [{ file: 'a.tsx', line: 2 }], confidence: 'high' },
      ]);
      // cart has no outgoing edge and is returned unchanged (same reference).
      expect(attached.find((s) => s.id === 'cart')).toBe(base[1]);
      // checkout keeps its authored edge and gains the resolved one (appended, not replaced).
      expect(attached.find((s) => s.id === 'checkout')!.transitions).toEqual([
        { to: 'home', trigger: 'link' },
        {
          to: 'cart',
          trigger: 'navigate',
          evidence: [{ file: 'b.tsx', line: 3 }],
          confidence: 'high',
        },
      ]);
    });

    it('does not mutate its inputs and collapses an exact-duplicate edge', () => {
      const frozen = JSON.parse(JSON.stringify(base));
      const dup = {
        from_id: 'home',
        transition: {
          to: 'cart',
          trigger: 'link',
          evidence: [{ file: 'a.tsx', line: 2 }],
          confidence: 'high' as const,
        },
      };
      const attached = attachResolvedTransitions(base, [dup, { ...dup }]);
      expect(attached.find((s) => s.id === 'home')!.transitions).toHaveLength(1);
      expect(base).toEqual(frozen);
    });

    it('dedups by identity when evidence is a single anchor or absent', () => {
      // A single (non-array) evidence anchor and an edge with no evidence at all both flow through
      // the de-dup key, so an identical pair collapses in each case.
      const single = {
        from_id: 'home',
        transition: {
          to: 'cart',
          trigger: 'link',
          evidence: { file: 'a.tsx', line: 2 },
          confidence: 'high' as const,
        },
      };
      const anchorless = {
        from_id: 'checkout',
        transition: { to: 'cart', trigger: 'navigate' },
      };
      const attached = attachResolvedTransitions(base, [
        single,
        { ...single },
        anchorless,
        { ...anchorless },
      ]);
      expect(attached.find((s) => s.id === 'home')!.transitions).toEqual([
        { to: 'cart', trigger: 'link', evidence: { file: 'a.tsx', line: 2 }, confidence: 'high' },
      ]);
      // checkout keeps its authored edge and gains the single de-duped anchorless one.
      expect(attached.find((s) => s.id === 'checkout')!.transitions).toEqual([
        { to: 'home', trigger: 'link' },
        { to: 'cart', trigger: 'navigate' },
      ]);
    });

    it('produces a schema-valid map once transitions are attached (INV-4)', () => {
      const attached = attachResolvedTransitions(base, [
        {
          from_id: 'home',
          transition: {
            to: 'cart',
            trigger: 'link',
            evidence: [{ file: 'a.tsx', line: 2 }],
            confidence: 'high',
          },
        },
      ]);
      const map: AppMap = {
        schema_version: 1,
        app: { name: 'demo', kind: 'web' },
        surfaces: attached,
      };
      expect(validateAppMap(map).valid).toBe(true);
    });
  });

  describe('buildUnresolvedLinksCheck (S9b)', () => {
    it('returns null when nothing was dropped (AC-3)', () => {
      expect(buildUnresolvedLinksCheck(0)).toBeNull();
      expect(buildUnresolvedLinksCheck(-1)).toBeNull();
    });

    it('names the exact dropped count, singular and plural (AC-3)', () => {
      const one = buildUnresolvedLinksCheck(1)!;
      expect(one.check).toBe('transition-resolution');
      expect(one.reason).toContain('1 navigation link ');
      expect(one.reason).toContain('was');

      const many = buildUnresolvedLinksCheck(3)!;
      expect(many.reason).toContain('3 navigation links ');
      expect(many.reason).toContain('were');
      expect(many.install_hint).toContain('docs/site-map/app-map.yaml');
    });
  });

  describe('shared behaviour', () => {
    it('returns nothing for an empty record list or content with no navigation call', () => {
      expect(detectLaravelTransitions([])).toEqual([]);
      expect(detectReactRouterTransitions([])).toEqual([]);
      expect(detectNodeCliTransitions([])).toEqual([]);
      expect(detectLaravelTransitions([record('        $total = 1 + 2;')])).toEqual([]);
    });

    it('computes the line number across a multi-line source and does not mutate the input', () => {
      const content = `line one\nline two\n        return redirect()->route('home');`;
      const input = record(content);
      const frozen = JSON.parse(JSON.stringify(input));
      const [only] = detectLaravelTransitions([input]);
      expect(only!.evidence).toEqual([{ file: input.file, line: 3 }]);
      expect(input).toEqual(frozen);
    });

    it('scans every record in a batch', () => {
      const transitions = detectReactRouterTransitions([
        record("navigate('/a');", { from_raw_id: 'react-routes-a' }),
        record("navigate('/b');", { from_raw_id: 'react-routes-b' }),
      ]);
      expect(transitions.map((t) => `${t.from_raw_id}->${t.to_target}`)).toEqual([
        'react-routes-a->/a',
        'react-routes-b->/b',
      ]);
    });
  });
});
