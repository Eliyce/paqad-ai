import { describe, expect, it } from 'vitest';

import {
  detectLaravelTransitions,
  detectNodeCliTransitions,
  detectReactRouterTransitions,
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
