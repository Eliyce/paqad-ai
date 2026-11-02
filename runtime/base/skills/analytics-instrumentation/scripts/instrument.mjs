#!/usr/bin/env node

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
  const help = args.projectRoot === '--help' || args.projectRoot === '-h';
  if (
    help ||
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
    process.exit(help ? 0 : 1);
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
