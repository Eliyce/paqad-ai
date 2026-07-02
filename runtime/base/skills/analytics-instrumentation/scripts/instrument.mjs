#!/usr/bin/env node
// Purpose: Instrument one analytics event the tracking-plan-as-code way (issue #279). Writes
//          the per-event doc + refreshes the per-module index via the framework doc-tree
//          primitives, and prints the provider tracking-call snippet to paste into the source.
//          The agent supplies only the event name (in the project convention) and later the doc
//          body; the slug, path, doc scaffold, and snippet are computed here so casing-variant
//          duplicates cannot diverge and no path is hand-authored.
// Usage:   node scripts/instrument.mjs <project-root> \
//            --module <m> --feature <f> --event <name> --provider <p> [--provider <p> ...]
// Output:  JSON { docPath, written, snippet } on stdout.
// Exit:    0 on success, 1 on usage error.
// The `paqad-ai` package is imported dynamically AFTER argument validation so a usage error
// never depends on the built package being resolvable.

// Provider → how the event call reads at the call site. Data, not code: adding a provider is a
// row here, never a new branch. `%s` is replaced with the exact event name.
const SNIPPETS = {
  posthog: "posthog.capture('%s')",
  segment: "analytics.track('%s')",
  amplitude: "amplitude.track('%s')",
  mixpanel: "mixpanel.track('%s')",
  ga4: "gtag('event', '%s')",
  gtm: "dataLayer.push({ event: '%s' })",
  vercel: "track('%s')",
  plausible: "plausible('%s')",
};

function parseArgs(argv) {
  const out = { projectRoot: argv[0], module: '', feature: '', event: '', providers: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--module') out.module = value;
    else if (flag === '--feature') out.feature = value;
    else if (flag === '--event') out.event = value;
    else if (flag === '--provider') out.providers.push(value);
    else continue;
    i += 1;
  }
  return out;
}

function snippetFor(provider, event) {
  const template = SNIPPETS[provider] ?? "track('%s')";
  return template.replace('%s', event);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (
    !args.projectRoot ||
    !args.module ||
    !args.feature ||
    !args.event ||
    args.providers.length === 0
  ) {
    process.stdout.write(
      'Usage: node scripts/instrument.mjs <project-root> --module <m> --feature <f> ' +
        '--event <name> --provider <p> [--provider <p> ...]\n',
    );
    process.exit(1);
  }

  const { syncAnalyticsDocs } = await import('paqad-ai');
  const callSites = args.providers.map((provider) => ({ provider, eventName: args.event }));
  const result = await syncAnalyticsDocs(args.projectRoot, [
    { module: args.module, feature: args.feature, callSites },
  ]);

  const snippet = args.providers.map((provider) => snippetFor(provider, args.event)).join('\n');
  const docPath = result.written.concat(result.skipped).find((p) => p.endsWith('.md'));
  process.stdout.write(
    `${JSON.stringify({ docPath, written: result.written, snippet }, null, 2)}\n`,
  );
}

void main();
