// Transition detection — the S9a stage of the site-map rebuild (fixes D3: nothing in the
// engine produces a navigation edge, so every link is hand-typed). Pure detectors that turn
// already-gathered source records into RAW transitions: the deterministic material the later
// stages resolve to surfaces (S9b) and reconcile into findings (S9c). Mirrors `extraction.ts`
// — no I/O, no shell, no network — so every branch is exercised with in-memory fixtures; the
// impure gathering (reading the files a surface is authored in) lives in the gatherer.
//
// The evidence rule is not negotiable (INV-2): a transition is recorded only when the matched
// text is an actual navigation call. A bare href, an import, or a string that merely looks
// like a path is never recorded — the detectors match call syntax, never a lone literal.
// Confidence is `high` for an explicit framework navigation call and `low` for a
// convention-based match (INV-3). `to_target` is the route name, path, or command name exactly
// as written in the code; resolving it to a surface id is S9b, not this stage (INV-4).

import type { Confidence, Evidence } from '@/core/types/site-map.js';

/**
 * A raw navigation edge produced by detection — deterministic material for the resolution
 * stage (S9b). `from_raw_id` is the surface the navigation is written in; `to_target` is the
 * raw route name, path, or command name as written in the code (not yet a surface id).
 */
export interface ExtractedTransition {
  from_raw_id: string;
  to_target: string;
  /** What causes the move, e.g. `redirect`, `render`, `navigate`, `link`, `invoke`. */
  trigger: string;
  /** The resolving `file:line` where the navigation call occurs. */
  evidence: Evidence[];
  /** `high` for a framework navigation call, `low` for a convention-based match. */
  confidence: Confidence;
}

/**
 * One source unit to scan, as normalized by the gatherer: the surface the source belongs to,
 * the file it was read from, and the text to scan. The detectors never touch the filesystem —
 * the gatherer reads the bytes and hands them over, mirroring `extraction.ts`'s input records.
 */
export interface TransitionSourceRecord {
  /** The raw surface id this source is authored in (the edge's origin). */
  from_raw_id: string;
  /** Repo-relative posix path the source was read from (the evidence `file`). */
  file: string;
  /** The source text to scan for navigation calls. */
  content: string;
}

/** 1-based line number of the character at `index` within `content`. */
function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * Scan every record's content for `pattern` (whose first capture group is the raw target) and
 * emit one transition per match, stamped with the given trigger and confidence. `pattern` must
 * be a global regex whose group cannot match empty (each detector's group is `[^'"]+`), so a
 * match always carries a non-empty target. `lastIndex` is reset per record so a shared const
 * regex is safe to reuse across records.
 */
function collect(
  records: TransitionSourceRecord[],
  pattern: RegExp,
  trigger: string,
  confidence: Confidence,
): ExtractedTransition[] {
  const transitions: ExtractedTransition[] = [];
  for (const record of records) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(record.content)) !== null) {
      transitions.push({
        from_raw_id: record.from_raw_id,
        to_target: match[1]!,
        trigger,
        evidence: [{ file: record.file, line: lineOf(record.content, match.index) }],
        confidence,
      });
    }
  }
  return transitions;
}

// --- Laravel ---------------------------------------------------------------------------------
// Framework navigation calls (high): a controller sends the user on with `redirect()->route`,
// `redirect('/path')`, or `to_route`, or renders a page with `Inertia::render`. `view('name')`
// is a weaker, convention-based signal (low): a returned view names the surface, but the call
// alone does not prove a move between surfaces. A bare `route('name')` (URL building, not
// navigation) has no detector, so it is never recorded (INV-2).

const REDIRECT_ROUTE_RE = /\bredirect\(\s*\)\s*->\s*route\(\s*['"]([^'"]+)['"]/g;
const TO_ROUTE_RE = /\bto_route\(\s*['"]([^'"]+)['"]/g;
const REDIRECT_PATH_RE = /\bredirect\(\s*['"]([^'"]+)['"]/g;
const INERTIA_RENDER_RE = /\bInertia::render\(\s*['"]([^'"]+)['"]/g;
const VIEW_RE = /\bview\(\s*['"]([^'"]+)['"]/g;

/**
 * Laravel transition detector. Records a `high`-confidence edge for each `redirect()->route`,
 * `redirect('/path')`, `to_route`, and `Inertia::render`, and a `low`-confidence edge for each
 * `view('name')` inside a routed action. `to_target` is the route name, path, or view/page
 * name as written; resolution to a surface is S9b.
 */
export function detectLaravelTransitions(records: TransitionSourceRecord[]): ExtractedTransition[] {
  return [
    ...collect(records, REDIRECT_ROUTE_RE, 'redirect', 'high'),
    ...collect(records, TO_ROUTE_RE, 'redirect', 'high'),
    ...collect(records, REDIRECT_PATH_RE, 'redirect', 'high'),
    ...collect(records, INERTIA_RENDER_RE, 'render', 'high'),
    ...collect(records, VIEW_RE, 'render', 'low'),
  ];
}

// --- React Router ----------------------------------------------------------------------------
// All three are explicit React Router navigation constructs (high): the programmatic
// `navigate('/path')`, the `<Link to="/path">` element, and the declarative `<Navigate
// to="/path">` redirect. A bare `<a href="/path">` is not React Router navigation, so it has no
// detector and is never recorded (INV-2). A `to={expr}` with a non-string value is dynamic and
// is left for a human, not guessed.

const NAVIGATE_RE = /\bnavigate\(\s*['"]([^'"]+)['"]/g;
const LINK_TO_RE = /<Link\b[^>]*?\bto=\s*['"]([^'"]+)['"]/g;
const NAVIGATE_JSX_RE = /<Navigate\b[^>]*?\bto=\s*['"]([^'"]+)['"]/g;

/**
 * React Router transition detector. Records a `high`-confidence edge for each
 * `navigate('/path')`, `<Link to="/path">`, and `<Navigate to="/path">`. `to_target` is the URL
 * path as written; resolution to a surface is S9b.
 */
export function detectReactRouterTransitions(
  records: TransitionSourceRecord[],
): ExtractedTransition[] {
  return [
    ...collect(records, NAVIGATE_RE, 'navigate', 'high'),
    ...collect(records, LINK_TO_RE, 'link', 'high'),
    ...collect(records, NAVIGATE_JSX_RE, 'redirect', 'high'),
  ];
}

// --- Node CLI --------------------------------------------------------------------------------
// A command invokes another command through an explicit dispatch helper (`runCommand`,
// `invokeCommand`, `dispatchCommand`) carrying a quoted target command name. This is a
// convention-based match (low): the helper name is a convention, not a framework primitive, and
// a command *declaration* (`program.command('build')`) or a mention in a description string is
// not an invocation, so neither is recorded (INV-2). Resolving the command name to a surface is
// S9b.

const CLI_DISPATCH_RE = /\b(?:runCommand|invokeCommand|dispatchCommand)\(\s*['"]([^'"]+)['"]/g;

/**
 * Node-CLI transition detector. Records a `low`-confidence edge when a command's source
 * dispatches another command by name through a dispatch helper. `to_target` is the command name
 * as written; resolution to a surface is S9b.
 */
export function detectNodeCliTransitions(records: TransitionSourceRecord[]): ExtractedTransition[] {
  return collect(records, CLI_DISPATCH_RE, 'invoke', 'low');
}
