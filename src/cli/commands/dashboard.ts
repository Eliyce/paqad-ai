import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { PATHS } from '@/core/constants/paths.js';
import { startDashboardServer } from '@/dashboard/server.js';
import { openBrowser } from '@/graph/opener.js';

interface DashboardCommandOptions {
  port: string;
  host: string;
  open: boolean;
  watch: boolean;
  quiet: boolean;
  readOnly: boolean;
  projectRoot: string;
  staticDir?: string;
}

const DEFAULT_PORT = 5372;

function resolveStaticDir(override: string | undefined): string {
  if (override) {
    return isAbsolute(override) ? override : resolve(process.cwd(), override);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  // Same bundled assets as `paqad-ai graph` — the SPA contains both
  // routes (#/graph and #/dashboard).
  const candidates = [
    resolve(here, '../../runtime/graph-ui'),
    resolve(here, '../../../runtime/graph-ui'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return candidates[0]!;
}

export function createDashboardCommand(): Command {
  return new Command('dashboard')
    .description('Open the paqad-ai project dashboard in a local web view')
    .option('--port <n>', 'Server port (auto-increments if occupied)', String(DEFAULT_PORT))
    .option('--host <host>', 'Bind address', '127.0.0.1')
    .option('--no-open', 'Do not open the browser automatically')
    .option('--no-watch', 'Disable live reload on .paqad/ changes')
    .option('--quiet', 'Suppress non-essential stdout', false)
    .option('--read-only', 'Disable every mutation endpoint (for shared or CI usage)', false)
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--static-dir <path>', 'Override the bundled frontend directory')
    .action(async (options: DashboardCommandOptions) => {
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
      const port = Number.parseInt(options.port, 10);
      if (!Number.isFinite(port) || port <= 0 || port > 65535) {
        process.stderr.write(`error: invalid --port value '${options.port}'\n`);
        process.exitCode = 2;
        return;
      }

      const staticDir = resolveStaticDir(options.staticDir);
      const server = await startDashboardServer({
        projectRoot,
        host: options.host,
        port,
        staticDir,
        watch: options.watch,
        readOnly: options.readOnly,
      });

      const dashboardUrl = `${server.url}/#/dashboard`;
      if (!options.quiet) {
        process.stdout.write(`paqad-ai dashboard listening at ${dashboardUrl}\n`);
      } else {
        process.stdout.write(`${dashboardUrl}\n`);
      }

      const opened = openBrowser({ url: dashboardUrl, skip: !options.open });
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
