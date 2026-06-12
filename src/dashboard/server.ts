import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { createGzip, gzipSync } from 'node:zlib';

import { PATHS } from '@/core/constants/paths.js';
import { DecisionPacketCorruptError } from '@/core/errors/engine-errors.js';
import { engineLog } from '@/core/logger-registry.js';
import { startPaqadWatcher, type RunningWatcher } from '@/graph/watcher.js';

import {
  acceptModuleProposal,
  ApprovalConflictError,
  ApprovalNotFoundError,
  buildApprovalsFeed,
  rejectModuleProposal,
  resolvePauseDecision,
} from './approvals.js';
import { readAuditFeed } from './audit-feed.js';
import { getDecisionContract, putDecisionContract } from './config-decision-contract.js';
import {
  DeliveryPolicyValidationError,
  getDeliveryPolicyConfig,
  putDeliveryPolicy,
} from './config-delivery-policy.js';
import { getDesignTokensConfig, putDesignTokens } from './config-design-tokens.js';
import { getModuleMapConfig, putModuleMap } from './config-module-map.js';
import { getProfileConfig, putProfile, setCapability } from './config-profile.js';
import { getRagConfig, putRagConfig } from './config-rag.js';
import { buildEvidencePacket } from './export-packet.js';
import { listInstructionsTree, readInstructionsFile } from './instructions-files.js';
import { buildInventory } from './inventory.js';
import { renderMarkdown } from './markdown.js';
import { buildOnboardingChecklist } from './onboarding-checklist.js';
import { isOpsAction, OpsConflictError, OpsJobRunner } from './ops-jobs.js';
import { installPack, listPacks, removePack } from './packs-config.js';
import { buildReport } from './report.js';
import { PathNotAllowedError, WriteConflictError, writeManagedFile } from './write-pipeline.js';
import {
  buildEvidenceFeed,
  buildPrCommentMarkdown,
  buildReceiptFeed,
  readAiBomDocument,
} from './trust.js';
import type { DashboardReport } from './types.js';

export interface DashboardServerOptions {
  projectRoot: string;
  host: string;
  port: number;
  /** Directory holding the bundled graph-ui SPA (re-used for the dashboard). */
  staticDir: string;
  /** If false, the server does not watch `.paqad/` for changes. */
  watch?: boolean;
  /** Quiet period for the watcher in milliseconds. Default 500. */
  watchDebounceMs?: number;
  /** If true, every mutation endpoint refuses with 403 (for shared/CI usage). */
  readOnly?: boolean;
}

export interface RunningDashboardServer {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function clientAcceptsGzip(req: IncomingMessage): boolean {
  const header = req.headers['accept-encoding'];
  if (!header) return false;
  const value = Array.isArray(header) ? header.join(',') : header;
  return value.toLowerCase().includes('gzip');
}

function writeJson(res: ServerResponse, req: IncomingMessage, body: unknown, status = 200): void {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  if (clientAcceptsGzip(req)) {
    const gz = gzipSync(json);
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = String(gz.byteLength);
    res.writeHead(status, headers);
    res.end(gz);
    return;
  }
  headers['content-length'] = String(Buffer.byteLength(json));
  res.writeHead(status, headers);
  res.end(json);
}

function writeText(
  res: ServerResponse,
  body: string,
  status = 200,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': String(Buffer.byteLength(body)),
  });
  res.end(body);
}

function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticDir: string,
  urlPath: string,
): void {
  const safePath = normalize(urlPath).replace(/^[/\\]+/, '');
  let filePath = join(staticDir, safePath);
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(staticDir))) {
    writeText(res, 'Forbidden', 403);
    return;
  }
  if (!existsSync(filePath)) {
    // SPA fallback so the hash router can take over.
    filePath = join(staticDir, 'index.html');
    if (!existsSync(filePath)) {
      writeText(res, 'Not Found', 404);
      return;
    }
  }
  let st;
  try {
    st = statSync(filePath);
  } catch {
    writeText(res, 'Not Found', 404);
    return;
  }
  if (st.isDirectory()) {
    filePath = join(filePath, 'index.html');
    if (!existsSync(filePath)) {
      writeText(res, 'Not Found', 404);
      return;
    }
  }
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'content-type': contentType,
    'cache-control': 'no-cache',
  };
  const shouldGzip =
    clientAcceptsGzip(req) &&
    /^(application\/javascript|text\/|application\/json|image\/svg)/.test(contentType);
  if (shouldGzip) {
    headers['content-encoding'] = 'gzip';
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(createGzip()).pipe(res);
  } else {
    headers['content-length'] = String(st.size);
    res.writeHead(200, headers);
    createReadStream(filePath).pipe(res);
  }
}

const MAX_BODY_BYTES = 64 * 1024;

/** Read and parse a JSON request body, capped at {@link MAX_BODY_BYTES}. */
function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        rejectBody(new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        rejectBody(new Error('Request body is not valid JSON.'));
      }
    });
    req.on('error', rejectBody);
  });
}

/** True when the request's Host header names a loopback address. */
function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const name = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

/**
 * True when the Origin header, if present, points back at this server.
 * Browsers always send Origin on cross-site POSTs, so a foreign value means a
 * web page elsewhere is trying to drive the local API (DNS-rebinding/CSRF).
 * Same-machine CLI clients send no Origin and pass.
 */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    // Includes `Origin: null` (sandboxed iframes, file://) — treated as foreign.
    return false;
  }
}

async function tryListen(server: Server, host: string, startPort: number): Promise<number> {
  let port = startPort;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (err: NodeJS.ErrnoException): void => {
          server.off('listening', onListening);
          rejectListen(err);
        };
        const onListening = (): void => {
          server.off('error', onError);
          resolveListen();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, host);
      });
      const addr = server.address() as AddressInfo | null;
      return addr?.port ?? port;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Could not bind to any port starting at ${startPort}`);
}

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<RunningDashboardServer> {
  let cachedReport: DashboardReport = buildReport(options.projectRoot);
  const sseClients = new Set<ServerResponse>();
  let watcher: RunningWatcher | null = null;

  function refreshReport(): void {
    cachedReport = buildReport(options.projectRoot);
  }

  function broadcastSse(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(payload);
      } catch {
        // ignore — failed client will be cleaned up by its 'close' handler
      }
    }
  }

  function onArtefactChange(): void {
    try {
      refreshReport();
      broadcastSse('dashboard-updated', { generatedAt: cachedReport.generatedAt });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcastSse('dashboard-error', { message });
    }
  }

  if (options.watch !== false) {
    watcher = startPaqadWatcher({
      projectRoot: options.projectRoot,
      debounceMs: options.watchDebounceMs,
      onChange: onArtefactChange,
    });
  }

  // Safe operations (spec 3D): jobs stream progress over SSE and refresh the
  // report when they finish, so cards update without waiting for the watcher.
  const opsRunner = new OpsJobRunner({
    projectRoot: options.projectRoot,
    onEvent: (event) => {
      broadcastSse('ops-progress', event);
      if (event.status !== 'running') {
        onArtefactChange();
      }
    },
  });

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      engineLog('error', 'Unhandled dashboard server error', {
        error: err instanceof Error ? err.message : String(err),
      });
      writeJson(res, req, { error: 'Internal server error' }, 500);
    });
  });

  /**
   * Gate every mutation behind the issue #146 guardrails: onboarded project
   * only, refused in `--read-only` mode, loopback Host (DNS-rebinding guard),
   * same-origin when a browser sends Origin. Returns null when the request may
   * proceed; otherwise writes the refusal and returns the status it sent.
   */
  function guardMutation(req: IncomingMessage, res: ServerResponse): number | null {
    if (options.readOnly === true) {
      writeJson(
        res,
        req,
        { error: 'This dashboard is running in read-only mode. Mutations are disabled.' },
        403,
      );
      return 403;
    }
    if (!existsSync(join(options.projectRoot, PATHS.ONBOARDING_MANIFEST))) {
      writeJson(
        res,
        req,
        { error: 'Project is not onboarded. Run `paqad-ai onboard` first.' },
        409,
      );
      return 409;
    }
    if (!isLoopbackHost(req.headers.host) || !isSameOrigin(req)) {
      writeJson(res, req, { error: 'Mutations are accepted from this machine only.' }, 403);
      return 403;
    }
    return null;
  }

  /** Map a thrown mutation error onto the HTTP status the inbox expects. */
  function writeMutationError(req: IncomingMessage, res: ServerResponse, err: unknown): void {
    if (err instanceof ApprovalNotFoundError) {
      writeJson(res, req, { error: err.message }, 404);
      return;
    }
    if (err instanceof WriteConflictError) {
      // Spec 6.3 — the friendly merge prompt: 409 plus the current content so
      // the client can render a side-by-side diff.
      writeJson(
        res,
        req,
        { error: err.message, conflict: { content: err.currentContent, hash: err.currentHash } },
        409,
      );
      return;
    }
    if (err instanceof ApprovalConflictError || err instanceof DecisionPacketCorruptError) {
      writeJson(res, req, { error: err.message }, 409);
      return;
    }
    if (err instanceof PathNotAllowedError) {
      writeJson(res, req, { error: err.message }, 403);
      return;
    }
    if (err instanceof OpsConflictError) {
      writeJson(res, req, { error: err.message }, 409);
      return;
    }
    if (
      err instanceof DeliveryPolicyValidationError ||
      (err instanceof Error && Array.isArray((err as { issues?: unknown }).issues))
    ) {
      // Every config validation error carries field-level `issues`.
      writeJson(
        res,
        req,
        { error: err.message, issues: (err as unknown as { issues: unknown }).issues },
        422,
      );
      return;
    }
    writeJson(res, req, { error: err instanceof Error ? err.message : String(err) }, 400);
  }

  async function handleMutation(
    req: IncomingMessage,
    res: ServerResponse,
    mutate: () => unknown | Promise<unknown>,
  ): Promise<void> {
    if (guardMutation(req, res) !== null) return;
    try {
      const result = await mutate();
      // Refresh + broadcast immediately so every open client updates without
      // waiting for the .paqad/ watcher debounce.
      onArtefactChange();
      writeJson(res, req, { ok: true, result });
    } catch (err) {
      writeMutationError(req, res, err);
    }
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${options.host}:${options.port}`);
    const pathname = url.pathname;

    if (pathname === '/api/health') {
      writeJson(res, req, { ok: true });
      return;
    }
    if (pathname === '/api/decisions' && req.method === 'GET') {
      writeJson(res, req, buildApprovalsFeed(options.projectRoot));
      return;
    }
    const resolveMatch = /^\/api\/decisions\/(D-\d+)\/resolve$/.exec(pathname);
    if (resolveMatch && req.method === 'POST') {
      const decisionId = resolveMatch[1];
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as {
          chosen_option_key?: unknown;
          note?: unknown;
        };
        if (typeof body.chosen_option_key !== 'string' || body.chosen_option_key.length === 0) {
          throw new Error('Body must include a non-empty `chosen_option_key` string.');
        }
        return resolvePauseDecision(options.projectRoot, {
          decisionId,
          chosenOptionKey: body.chosen_option_key,
          ...(typeof body.note === 'string' && body.note.length > 0 ? { note: body.note } : {}),
        });
      });
      return;
    }
    const proposalMatch = /^\/api\/module-decisions\/(MD-\d{4,})\/(accept|reject)$/.exec(pathname);
    if (proposalMatch && req.method === 'POST') {
      const [, proposalId, action] = proposalMatch;
      await handleMutation(req, res, () =>
        action === 'accept'
          ? acceptModuleProposal(options.projectRoot, proposalId)
          : rejectModuleProposal(options.projectRoot, proposalId),
      );
      return;
    }
    if (pathname === '/api/ledger/evidence') {
      const limitRaw = url.searchParams.get('limit');
      const limit = limitRaw === null ? undefined : Number.parseInt(limitRaw, 10);
      writeJson(
        res,
        req,
        buildEvidenceFeed(options.projectRoot, {
          gate: url.searchParams.get('gate') ?? undefined,
          verdict: url.searchParams.get('verdict') ?? undefined,
          ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
        }),
      );
      return;
    }
    if (pathname === '/api/ledger/receipts') {
      writeJson(res, req, buildReceiptFeed(options.projectRoot));
      return;
    }
    if (pathname === '/api/ledger/ai-bom') {
      writeJson(res, req, {
        generatedAt: new Date().toISOString(),
        document: readAiBomDocument(options.projectRoot),
      });
      return;
    }
    if (pathname === '/api/ledger/pr-comment') {
      const markdown = buildPrCommentMarkdown(
        options.projectRoot,
        url.searchParams.get('sha') ?? undefined,
      );
      if (markdown === null) {
        writeJson(
          res,
          req,
          { error: 'No verification evidence yet. The comment appears after the first gate run.' },
          404,
        );
        return;
      }
      writeText(res, markdown, 200, 'text/markdown; charset=utf-8');
      return;
    }
    if (pathname === '/api/inventory' && req.method === 'GET') {
      writeJson(res, req, buildInventory(options.projectRoot));
      return;
    }
    if (pathname === '/api/config/delivery-policy' && req.method === 'GET') {
      writeJson(res, req, getDeliveryPolicyConfig(options.projectRoot));
      return;
    }
    if (pathname === '/api/config/delivery-policy' && req.method === 'PUT') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { content?: unknown; baseHash?: unknown };
        if (typeof body.content !== 'string') {
          throw new Error('Body must include the policy `content` as a string.');
        }
        return putDeliveryPolicy(options.projectRoot, {
          content: body.content,
          baseHash: typeof body.baseHash === 'string' ? body.baseHash : null,
        });
      });
      return;
    }
    if (pathname === '/api/files/instructions' && req.method === 'GET') {
      writeJson(res, req, listInstructionsTree(options.projectRoot));
      return;
    }
    const instructionsFileMatch = /^\/api\/files\/instructions\/(.+)$/.exec(pathname);
    if (instructionsFileMatch && req.method === 'GET') {
      try {
        writeJson(
          res,
          req,
          readInstructionsFile(options.projectRoot, decodeURIComponent(instructionsFileMatch[1]!)),
        );
      } catch (err) {
        writeMutationError(req, res, err);
      }
      return;
    }
    if (instructionsFileMatch && req.method === 'PUT') {
      const relative = decodeURIComponent(instructionsFileMatch[1]!);
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { content?: unknown; baseHash?: unknown };
        if (typeof body.content !== 'string') {
          throw new Error('Body must include the file `content` as a string.');
        }
        return writeManagedFile(options.projectRoot, {
          relativePath: `${PATHS.INSTRUCTIONS_DIR}/${relative}`,
          content: body.content,
          baseHash: typeof body.baseHash === 'string' ? body.baseHash : null,
          action: 'dashboard.instructions.write',
        });
      });
      return;
    }
    if (pathname === '/api/config/profile' && req.method === 'GET') {
      writeJson(res, req, getProfileConfig(options.projectRoot));
      return;
    }
    if (pathname === '/api/config/profile' && req.method === 'PUT') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { profile?: unknown };
        return putProfile(options.projectRoot, body.profile);
      });
      return;
    }
    const capabilityMatch = /^\/api\/capabilities\/([a-z-]+)$/.exec(pathname);
    if (capabilityMatch && req.method === 'POST') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { enabled?: unknown };
        if (typeof body.enabled !== 'boolean') {
          throw new Error('Body must include `enabled` as a boolean.');
        }
        return setCapability(options.projectRoot, capabilityMatch[1]!, body.enabled);
      });
      return;
    }
    if (pathname === '/api/config/module-map' && req.method === 'GET') {
      writeJson(res, req, getModuleMapConfig(options.projectRoot));
      return;
    }
    if (pathname === '/api/config/module-map' && req.method === 'PUT') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { content?: unknown; baseHash?: unknown };
        if (typeof body.content !== 'string') {
          throw new Error('Body must include the module map `content` as a string.');
        }
        return putModuleMap(options.projectRoot, {
          content: body.content,
          baseHash: typeof body.baseHash === 'string' ? body.baseHash : null,
        });
      });
      return;
    }
    if (pathname === '/api/config/rag' && req.method === 'GET') {
      writeJson(res, req, getRagConfig(options.projectRoot));
      return;
    }
    if (pathname === '/api/config/rag' && req.method === 'PUT') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { intelligence?: unknown };
        return putRagConfig(options.projectRoot, body.intelligence);
      });
      return;
    }
    if (pathname === '/api/config/decision-contract' && req.method === 'GET') {
      writeJson(res, req, getDecisionContract(options.projectRoot));
      return;
    }
    if (pathname === '/api/config/decision-contract' && req.method === 'PUT') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { content?: unknown; baseHash?: unknown };
        if (typeof body.content !== 'string') {
          throw new Error('Body must include the contract `content` as a string.');
        }
        return putDecisionContract(options.projectRoot, {
          content: body.content,
          baseHash: typeof body.baseHash === 'string' ? body.baseHash : null,
        });
      });
      return;
    }
    if (pathname === '/api/config/design-tokens' && req.method === 'GET') {
      writeJson(res, req, getDesignTokensConfig(options.projectRoot));
      return;
    }
    if (pathname === '/api/config/design-tokens' && req.method === 'PUT') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { content?: unknown; baseHash?: unknown };
        if (typeof body.content !== 'string') {
          throw new Error('Body must include the tokens `content` as a string.');
        }
        return putDesignTokens(options.projectRoot, {
          content: body.content,
          baseHash: typeof body.baseHash === 'string' ? body.baseHash : null,
        });
      });
      return;
    }
    if (pathname === '/api/packs' && req.method === 'GET') {
      writeJson(res, req, listPacks(options.projectRoot));
      return;
    }
    if (pathname === '/api/packs/install' && req.method === 'POST') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { source?: unknown; scope?: unknown };
        if (typeof body.source !== 'string' || body.source.length === 0) {
          throw new Error('Body must include the pack `source` as a string.');
        }
        return installPack(options.projectRoot, {
          source: body.source,
          scope: body.scope === 'global' ? 'global' : 'project',
        });
      });
      return;
    }
    if (pathname === '/api/packs/remove' && req.method === 'POST') {
      await handleMutation(req, res, async () => {
        const body = (await readJsonBody(req)) as { name?: unknown; scope?: unknown };
        if (typeof body.name !== 'string' || body.name.length === 0) {
          throw new Error('Body must include the pack `name` as a string.');
        }
        return removePack(options.projectRoot, {
          name: body.name,
          scope: body.scope === 'global' ? 'global' : 'project',
        });
      });
      return;
    }
    const opsActionMatch = /^\/api\/ops\/([a-z-]+)$/.exec(pathname);
    if (opsActionMatch && req.method === 'POST') {
      const action = opsActionMatch[1]!;
      if (!isOpsAction(action)) {
        writeJson(res, req, { error: `Unknown operation: ${action}` }, 404);
        return;
      }
      await handleMutation(req, res, () => opsRunner.start(action));
      return;
    }
    const opsJobMatch = /^\/api\/ops\/(op-[a-z-]+-\d+)$/.exec(pathname);
    if (opsJobMatch && req.method === 'GET') {
      const job = opsRunner.get(opsJobMatch[1]!);
      if (job === null) {
        writeJson(res, req, { error: `Unknown job: ${opsJobMatch[1]!}` }, 404);
        return;
      }
      writeJson(res, req, job);
      return;
    }
    if (pathname === '/api/ops' && req.method === 'GET') {
      writeJson(res, req, { jobs: opsRunner.list() });
      return;
    }
    if (pathname === '/api/audit' && req.method === 'GET') {
      const limitRaw = url.searchParams.get('limit');
      const cursorRaw = url.searchParams.get('cursor');
      writeJson(
        res,
        req,
        readAuditFeed(options.projectRoot, {
          ...(limitRaw !== null ? { limit: Number.parseInt(limitRaw, 10) } : {}),
          ...(cursorRaw !== null ? { cursor: Number.parseInt(cursorRaw, 10) } : {}),
        }),
      );
      return;
    }
    if (pathname === '/api/onboarding-checklist' && req.method === 'GET') {
      writeJson(res, req, buildOnboardingChecklist(options.projectRoot));
      return;
    }
    if (pathname === '/api/export/evidence-packet' && req.method === 'GET') {
      const packet = buildEvidencePacket(options.projectRoot, {
        projectName: cachedReport.projectName,
      });
      const format = url.searchParams.get('format');
      if (format === 'html') {
        writeText(res, packet.html, 200, 'text/html; charset=utf-8');
        return;
      }
      if (format === 'markdown') {
        writeText(res, packet.markdown, 200, 'text/markdown; charset=utf-8');
        return;
      }
      writeJson(res, req, packet);
      return;
    }
    if (pathname === '/api/dashboard') {
      // Always rebuild — the report is cheap and the watcher might have
      // lagged. Keeps SSE clients and direct hits consistent.
      refreshReport();
      writeJson(res, req, cachedReport);
      return;
    }
    if (pathname === '/api/dashboard/markdown') {
      refreshReport();
      writeText(res, renderMarkdown(cachedReport), 200, 'text/markdown; charset=utf-8');
      return;
    }
    if (pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('retry: 5000\n\n');
      sseClients.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          /* ignore */
        }
      }, 20000);
      const cleanup = (): void => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      };
      req.on('close', cleanup);
      req.on('error', cleanup);
      return;
    }
    if (pathname.startsWith('/api/')) {
      writeJson(res, req, { error: `Unknown endpoint: ${pathname}` }, 404);
      return;
    }
    serveStatic(req, res, options.staticDir, pathname === '/' ? '/index.html' : pathname);
  }

  const boundPort = await tryListen(server, options.host, options.port);
  const url = `http://${options.host}:${boundPort}`;

  return {
    url,
    host: options.host,
    port: boundPort,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        watcher?.close();
        watcher = null;
        for (const res of sseClients) {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
        sseClients.clear();
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}
