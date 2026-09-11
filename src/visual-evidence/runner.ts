// Visual-evidence runner (issue #551, Part E.5).
//
// The ONLY writer of `visual-evidence.json` + the `screenshots/` subtree. Boots the app,
// captures each planned flow's documented steps with Playwright, isolates a failed selector to
// its own flow, assembles the overview GIF, and writes the bundle artifacts atomically
// (latest-run-wins: build into a temp sibling, then rename over). Real browser + fs work →
// excluded from unit coverage; exercised by the env-gated integration test.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { computeContentHash } from '@/feature-evidence/mint.js';
import { featureFilePath, featureScreenshotsDir } from '@/feature-evidence/paths.js';
import { validateVisualEvidenceRecord } from '@/feature-evidence/schema.js';
import type { ProjectProfile } from '@/core/types/project-profile.js';

import { bootApp } from './boot.js';
import { deriveCaption } from './capture-script.js';
import { assembleOverviewGif, type GifFrameInput } from './gif.js';
import {
  browserStatus,
  provisionBrowser,
  resolvePlaywrightModulePath,
  resolveVeRuntimeDir,
  veBrowsersPath,
} from './provision.js';
import { resolveVisualEvidencePlan, type ResolvedPlanEntry } from './resolve-plan.js';
import type { CaptureAction, CaptureStep } from './capture-script.js';
import {
  VISUAL_EVIDENCE_DOC_TYPE,
  VISUAL_EVIDENCE_SCHEMA_VERSION,
  type VeSkip,
  type VeStep,
  type VeTrigger,
  type VisualEvidenceManifest,
} from './types.js';

export interface RunVisualEvidenceInput {
  projectRoot: string;
  dirName: string;
  profile: ProjectProfile | null;
  trigger: VeTrigger;
  changedFiles: string[];
  now?: () => string;
}

export interface RunVisualEvidenceResult {
  wrote: boolean;
  manifest: VisualEvidenceManifest | null;
  result: 'captured' | 'partial' | 'skipped';
  skips: VeSkip[];
}

/** Windows-safe kebab slug of a caption: [a-z0-9-] only, max 40, non-empty fallback. */
export function slugifyCaption(caption: string): string {
  const slug = caption
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'step';
}

/** Zero-padded 2-digit position (01..99, clamped at 99 for the dir name). */
export function pad2(n: number): string {
  return String(Math.min(n, 99)).padStart(2, '0');
}

/** Resolve a `$VE_*` reference from the environment; a bare value passes through unchanged. */
function resolveValue(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (value === undefined) return undefined;
  const match = /^\$(\w+)$/.exec(value);
  if (!match) return value;
  return env[match[1]!];
}

/** Playwright's Page, structurally typed so the module never imports playwright at build time. */
interface PwPage {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  selectOption(selector: string, value: string): Promise<unknown>;
  press(selector: string, key: string): Promise<void>;
  waitForSelector(selector: string, options: { state: 'visible' | 'hidden' }): Promise<unknown>;
  screenshot(options: { fullPage: boolean }): Promise<Buffer>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  evaluate<T>(fn: (arg: unknown) => T, arg: unknown): Promise<T>;
}
interface PwBrowser {
  newPage(options?: { viewport: { width: number; height: number } }): Promise<PwPage>;
  close(): Promise<void>;
}

async function runAction(page: PwPage, action: CaptureAction, env: NodeJS.ProcessEnv): Promise<void> {
  const value = resolveValue(action.value, env);
  switch (action.do) {
    case 'click':
      await page.click(action.selector);
      return;
    case 'fill':
      await page.fill(action.selector, value ?? '');
      return;
    case 'select':
      await page.selectOption(action.selector, value ?? '');
      return;
    case 'press':
      await page.press(action.selector, value ?? '');
      return;
    case 'wait_for':
      await page.waitForSelector(action.selector, {
        state: value === 'hidden' ? 'hidden' : 'visible',
      });
      return;
  }
}

/** True when a capture action references a `$VE_*` env var that is not set. */
function missingEnvVar(action: CaptureAction, env: NodeJS.ProcessEnv): boolean {
  if (action.value === undefined) return false;
  const match = /^\$(\w+)$/.exec(action.value);
  return match !== null && env[match[1]!] === undefined;
}

function resolveUrl(base: string, path: string | undefined): string {
  if (!path) return base;
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

/** Dynamically import Playwright's chromium from the ve-runtime (never the target project). */
async function loadChromium(): Promise<{
  launch(options?: { headless?: boolean }): Promise<PwBrowser>;
}> {
  process.env.PLAYWRIGHT_BROWSERS_PATH = veBrowsersPath();
  const modulePath = resolvePlaywrightModulePath(resolveVeRuntimeDir());
  const mod = (await import(pathToFileURL(modulePath).href)) as {
    chromium?: { launch(o?: { headless?: boolean }): Promise<PwBrowser> };
    default?: { chromium: { launch(o?: { headless?: boolean }): Promise<PwBrowser> } };
  };
  const chromium = mod.chromium ?? mod.default?.chromium;
  if (!chromium) throw new Error('playwright chromium entry not found');
  return chromium;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Run visual evidence for the active feature. Returns what it wrote. Never throws for an
 * environmental miss — those become recorded skips so the CLI exits 0 and the gate decides.
 */
export async function runVisualEvidence(
  input: RunVisualEvidenceInput,
): Promise<RunVisualEvidenceResult> {
  const { projectRoot, dirName, profile, trigger, changedFiles } = input;
  const now = input.now ?? (() => new Date().toISOString());
  const env = process.env;

  const plan = resolveVisualEvidencePlan(projectRoot, changedFiles);
  const skips: VeSkip[] = [...plan.skips];

  // Nothing to capture — write a skip-only manifest (documented skips already recorded).
  if (plan.entries.length === 0) {
    return writeManifest(projectRoot, dirName, {
      trigger,
      plan: [],
      steps: [],
      gif: null,
      skips,
      result: 'skipped',
      now,
    });
  }

  // Ensure the browser runtime is provisioned (auto-attempt once when missing).
  let status = browserStatus();
  if (status !== 'provisioned') {
    try {
      await provisionBrowser();
      status = 'provisioned';
    } catch {
      skips.push({
        reason: 'playwright-not-provisioned',
        detail: 'Playwright/Chromium is not provisioned and provisioning failed (offline?)',
      });
      return writeManifest(projectRoot, dirName, {
        trigger,
        plan: planEntries(plan.entries),
        steps: [],
        gif: null,
        skips,
        result: 'skipped',
        now,
      });
    }
  }

  // Boot (or attach to) the app.
  const boot = await bootApp(projectRoot, profile);
  if (!boot.ok) {
    skips.push({ reason: boot.reason, detail: boot.detail });
    return writeManifest(projectRoot, dirName, {
      trigger,
      plan: planEntries(plan.entries),
      steps: [],
      gif: null,
      skips,
      result: 'skipped',
      now,
    });
  }

  const tmpDir = `${featureScreenshotsDir(dirName)}.tmp-${process.pid}`;
  const tmpAbs = join(projectRoot, tmpDir);
  rmSync(tmpAbs, { recursive: true, force: true });
  mkdirSync(tmpAbs, { recursive: true });

  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });
  const steps: VeStep[] = [];
  const gifFrames: GifFrameInput[] = [];
  const usedSlugs = new Set<string>();
  let index = 0;

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    for (const entry of plan.entries) {
      const captured = await captureFlow(page, entry, boot.url, env, {
        tmpAbs,
        startIndex: index,
        usedSlugs,
        now,
      });
      steps.push(...captured.steps);
      gifFrames.push(...captured.frames);
      skips.push(...captured.skips);
      index += captured.steps.length;
    }

    // Assemble the GIF from the CLEAN per-step screenshots.
    let gif: VisualEvidenceManifest['gif'] = null;
    if (gifFrames.length > 0) {
      const gifBytes = await assembleOverviewGif(page, gifFrames);
      if (gifBytes) {
        writeFileSync(join(tmpAbs, 'overview.gif'), gifBytes);
        gif = {
          file: 'screenshots/overview.gif',
          frames: Math.min(gifFrames.length, 12),
          frame_ms: 2000,
          sha256: sha256(gifBytes),
          bytes: gifBytes.length,
        };
      }
    }
    await browser.close();

    // Atomically replace the live screenshots/ with the temp build.
    const liveAbs = join(projectRoot, featureScreenshotsDir(dirName));
    rmSync(liveAbs, { recursive: true, force: true });
    renameSync(tmpAbs, liveAbs);

    const anyCaptured = steps.some((step) => step.status === 'captured');
    const anyFailed = steps.some((step) => step.status === 'failed');
    const result = anyCaptured ? (anyFailed ? 'partial' : 'captured') : 'skipped';

    return writeManifest(projectRoot, dirName, {
      trigger,
      plan: planEntries(plan.entries),
      steps,
      gif,
      skips,
      result,
      now,
    });
  } catch (error) {
    await browser.close().catch(() => undefined);
    rmSync(tmpAbs, { recursive: true, force: true });
    throw error;
  } finally {
    await boot.stop();
  }
}

interface CaptureFlowContext {
  tmpAbs: string;
  startIndex: number;
  usedSlugs: Set<string>;
  now: () => string;
}

interface CaptureFlowResult {
  steps: VeStep[];
  frames: GifFrameInput[];
  skips: VeSkip[];
}

/** Capture one flow. A failed selector stops THIS flow but keeps its prior steps. */
async function captureFlow(
  page: PwPage,
  entry: ResolvedPlanEntry,
  baseUrl: string,
  env: NodeJS.ProcessEnv,
  ctx: CaptureFlowContext,
): Promise<CaptureFlowResult> {
  const steps: VeStep[] = [];
  const frames: GifFrameInput[] = [];
  const skips: VeSkip[] = [];
  const { script, journey } = entry.loaded;

  // Setup runs once; a missing env var or failed selector skips the whole flow's setup.
  try {
    for (const setup of script.setup ?? []) {
      if (setup.goto) await page.goto(resolveUrl(baseUrl, setup.goto));
      for (const action of setup.actions ?? []) {
        if (missingEnvVar(action, env)) {
          skips.push({ reason: 'env-var-missing', detail: `${entry.journey_id}: ${action.value} is not set` });
          return { steps, frames, skips };
        }
        await runAction(page, action, env);
      }
    }
  } catch {
    skips.push({ reason: 'selector-not-found', detail: `${entry.journey_id}: setup selector failed` });
    return { steps, frames, skips };
  }

  let position = ctx.startIndex;
  for (const step of script.steps) {
    const caption = deriveCaption(journey, step.journey_step);
    position += 1;
    try {
      const outcome = await captureStep(page, step, caption, baseUrl, env, position, ctx);
      steps.push(outcome.step);
      if (outcome.frame) frames.push(outcome.frame);
    } catch {
      // EC-2: record the failed step, stop THIS flow, continue with the next.
      steps.push({
        index: position,
        journey_id: entry.journey_id,
        journey_step: step.journey_step,
        caption,
        dir: '',
        captured_at: ctx.now(),
        status: 'failed',
        failure: `selector-not-found while running journey_step ${step.journey_step}`,
      });
      skips.push({ reason: 'selector-not-found', detail: `${entry.journey_id} step ${step.journey_step}` });
      break;
    }
  }

  // Re-anchor journey_id onto steps (captureStep does not know it).
  for (const step of steps) {
    if (!step.journey_id) step.journey_id = entry.journey_id;
  }
  return { steps, frames, skips };
}

async function captureStep(
  page: PwPage,
  step: CaptureStep,
  caption: string,
  baseUrl: string,
  env: NodeJS.ProcessEnv,
  position: number,
  ctx: CaptureFlowContext,
): Promise<{ step: VeStep; frame: GifFrameInput | null }> {
  const route = step.goto;
  if (route) await page.goto(resolveUrl(baseUrl, route));
  for (const action of step.actions ?? []) {
    await runAction(page, action, env);
  }

  const capturedAt = ctx.now();
  const base: VeStep = {
    index: position,
    journey_id: '',
    journey_step: step.journey_step,
    caption,
    dir: '',
    route,
    captured_at: capturedAt,
    status: step.screenshot === false ? 'skipped' : 'captured',
  };

  if (step.screenshot === false) {
    return { step: base, frame: null };
  }

  const slug = uniqueSlug(slugifyCaption(caption), ctx.usedSlugs);
  const dir = `${pad2(position)}-${slug}`;
  const dirAbs = join(ctx.tmpAbs, dir);
  mkdirSync(dirAbs, { recursive: true });
  const png = await page.screenshot({ fullPage: true });
  const imageAbs = join(dirAbs, 'image.png');
  writeFileSync(imageAbs, png);
  writeFileSync(join(dirAbs, 'caption.txt'), `${caption}\n`, 'utf8');

  return {
    step: {
      ...base,
      dir: `screenshots/${dir}`,
      image_sha256: sha256(png),
      image_bytes: png.length,
    },
    frame: { imageAbsPath: imageAbs, caption },
  };
}

function uniqueSlug(slug: string, used: Set<string>): string {
  if (!used.has(slug)) {
    used.add(slug);
    return slug;
  }
  let n = 2;
  while (used.has(`${slug}-${n}`)) n += 1;
  const out = `${slug}-${n}`;
  used.add(out);
  return out;
}

function planEntries(entries: ResolvedPlanEntry[]): VisualEvidenceManifest['plan'] {
  return entries.map((entry) => ({
    journey_id: entry.journey_id,
    capture_script: entry.capture_script,
    matched_by: entry.matched_by,
  }));
}

interface WriteManifestInput {
  trigger: VeTrigger;
  plan: VisualEvidenceManifest['plan'];
  steps: VeStep[];
  gif: VisualEvidenceManifest['gif'];
  skips: VeSkip[];
  result: 'captured' | 'partial' | 'skipped';
  now: () => string;
}

/** Build, validate, and atomically write the manifest. */
function writeManifest(
  projectRoot: string,
  dirName: string,
  input: WriteManifestInput,
): RunVisualEvidenceResult {
  const base: Omit<VisualEvidenceManifest, 'content_hash'> = {
    schema_version: VISUAL_EVIDENCE_SCHEMA_VERSION,
    doc_type: VISUAL_EVIDENCE_DOC_TYPE,
    generated_at: input.now(),
    trigger: input.trigger,
    plan: input.plan,
    steps: input.steps,
    gif: input.gif,
    skips: input.skips,
    result: input.result,
  };
  const manifest: VisualEvidenceManifest = {
    ...base,
    content_hash: computeContentHash(base as unknown as Record<string, unknown>),
  };

  const errors = validateVisualEvidenceRecord(manifest);
  if (errors.length > 0) {
    throw new Error(`internal: visual-evidence manifest failed its own schema: ${errors.join('; ')}`);
  }

  const target = join(projectRoot, featureFilePath(dirName, 'visualEvidence'));
  mkdirSync(join(projectRoot, featureScreenshotsDir(dirName), '..'), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  renameSync(tmp, target);

  return { wrote: true, manifest, result: input.result, skips: input.skips };
}

/** True when the visual-evidence subtree exists in the bundle (for callers that check). */
export function hasVisualEvidence(projectRoot: string, dirName: string): boolean {
  return existsSync(join(projectRoot, featureFilePath(dirName, 'visualEvidence')));
}
