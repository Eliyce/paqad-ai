import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { PATHS } from '@/core/constants/paths.js';
import { startDashboardServer } from '@/dashboard/server.js';
import { isFrameworkDisabledForRoot } from '@/core/framework-enabled.js';
import { openBrowser } from '@/graph/opener.js';

interface GraphCommandOptions {
  port: string;
  host: string;
  open: boolean;
  watch: boolean;
  quiet: boolean;
  projectRoot: string;
  staticDir?: string;
}

// The graph now lives inside the dashboard, so the shim reuses the dashboard
// port range rather than the retired graph server's 5371.
const DEFAULT_PORT = 5372;

const DEPRECATION_LINE =
  'paqad-ai graph has moved into the dashboard. Opening the dashboard on the Graph view. Run paqad-ai dashboard next time.';

function resolveStaticDir(override: string | undefined): string {
  if (override) {
    return isAbsolute(override) ? override : resolve(process.cwd(), override);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../runtime/graph-ui'),
    resolve(here, '../../../runtime/graph-ui'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return candidates[0]!;
}

/**
 * Deprecated alias for `paqad-ai dashboard` (issue #159). The graph is now a
 * first-class dashboard area; this shim keeps the muscle-memory shortcut alive
 * for one minor version by opening the dashboard directly on the Graph view.
 * Registered hidden so it stays out of `--help`.
 */
export function createGraphCommand(): Command {
  return new Command('graph')
    .description('Deprecated: opens the dashboard on the Graph view')
    .option('--port <n>', 'Server port (auto-increments if occupied)', String(DEFAULT_PORT))
    .option('--host <host>', 'Bind address', '127.0.0.1')
    .option('--no-open', 'Do not open the browser automatically')
    .option('--no-watch', 'Disable live reload on .paqad/ changes')
    .option('--quiet', 'Suppress non-essential stdout', false)
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--static-dir <path>', 'Override the bundled frontend directory')
    .action(async (options: GraphCommandOptions) => {
      const projectRoot = resolve(options.projectRoot);
      const paqadDir = join(projectRoot, PATHS.AGENCY_DIR);
      if (!existsSync(paqadDir)) {
        process.stderr.write(
          `error: no .paqad/ directory found at ${projectRoot}. Run \`paqad-ai onboard\` first.\n`,
        );
        process.exitCode = 2;
        return;
      }
      const manifestPath = join(projectRoot, PATHS.ONBOARDING_MANIFEST);
      if (!existsSync(manifestPath)) {
        process.stderr.write(
          `error: onboarding manifest missing at ${manifestPath}. Run \`paqad-ai onboard\` first.\n`,
        );
        process.exitCode = 2;
        return;
      }
      // Issue #220 — vanilla mode includes the dashboard (the graph is a view in
      // it). Do not start the server when paqad is disabled.
      if (isFrameworkDisabledForRoot(projectRoot)) {
        process.stdout.write(
          'paqad is disabled (vanilla mode); the dashboard will not start. Run `paqad-ai enable` (or unset PAQAD_DISABLED) to use it.\n',
        );
        return;
      }
      const port = Number.parseInt(options.port, 10);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        process.stderr.write(`error: invalid --port value '${options.port}'\n`);
        process.exitCode = 2;
        return;
      }

      process.stderr.write(`${DEPRECATION_LINE}\n`);

      const staticDir = resolveStaticDir(options.staticDir);
      const server = await startDashboardServer({
        projectRoot,
        host: options.host,
        port,
        staticDir,
        watch: options.watch,
      });

      const graphUrl = `${server.url}/#/graph`;
      if (!options.quiet) {
        process.stdout.write(`paqad-ai dashboard listening at ${graphUrl}\n`);
      } else {
        process.stdout.write(`${graphUrl}\n`);
      }

      const opened = openBrowser({ url: graphUrl, skip: !options.open });
      if (!opened.opened && !options.quiet && opened.reason) {
        process.stdout.write(`(browser not opened: ${opened.reason})\n`);
      }

      const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (!options.quiet) {
          process.stdout.write(`\nReceived ${signal}, shutting down…\n`);
        }
        try {
          await server.close();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stderr.write(`error during shutdown: ${message}\n`);
          process.exitCode = 1;
          return;
        }
        process.exit(0);
      };

      process.on('SIGINT', () => void shutdown('SIGINT'));
      process.on('SIGTERM', () => void shutdown('SIGTERM'));
    });
}
