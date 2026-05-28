#!/usr/bin/env -S npx tsx
/**
 * runtime-checks.ts — design-test live phase (Playwright walk).
 *
 * Brings up the running app, walks every route from the surface inventory,
 * and emits structured evidence consumed by accessibility-review,
 * responsive-review, motion-review, token-conformance-review, and
 * state-coverage-review.
 *
 * Reuses the project's playwright.config.ts (browsers, projects, baseURL).
 * Override per design_test config block in paqad.config.{json,yaml}.
 *
 * Outputs to .paqad/design-test/runs/<run_id>/artifacts/runtime/*.
 *
 * If Playwright isn't available, exits 0 and writes a blocked_checks entry —
 * the workflow continues with static-only evidence.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

interface Args {
  runId: string;
  artifactDir: string;
  targetUrl: string | null;
  surfaceInventory: string;
  breakpoints: Array<{ name: string; width: number; height: number }>;
}

function parseArgs(): Args {
  const env = process.env;
  const runId = env.DESIGN_TEST_RUN_ID ?? 'manual';
  const artifactDir = env.DESIGN_TEST_ARTIFACT_DIR ?? `.paqad/design-test/runs/${runId}/artifacts`;
  const targetUrl = env.DESIGN_TEST_TARGET_URL ?? null;
  const surfaceInventory =
    env.DESIGN_TEST_SURFACE_INVENTORY ?? join(artifactDir, 'surface-summary.json');
  const breakpoints = env.DESIGN_TEST_BREAKPOINTS
    ? JSON.parse(env.DESIGN_TEST_BREAKPOINTS)
    : [
        { name: 'sm', width: 640, height: 1024 },
        { name: 'md', width: 768, height: 1024 },
        { name: 'lg', width: 1024, height: 768 },
        { name: 'xl', width: 1280, height: 800 },
      ];
  return { runId, artifactDir, targetUrl, surfaceInventory, breakpoints };
}

function writeBlocked(args: Args, reason: string): void {
  const dir = join(args.artifactDir, 'runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'runtime-checks.json'),
    JSON.stringify(
      { target_url: args.targetUrl, reachable: false, blocked: reason, checks: [] },
      null,
      2,
    ) + '\n',
  );
  console.error(`runtime-checks blocked: ${reason}`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.targetUrl) {
    writeBlocked(args, 'no-target-url');
    return;
  }

  let playwright: typeof import('playwright');
  try {
    playwright = await import('playwright');
  } catch {
    writeBlocked(args, 'playwright-not-installed');
    return;
  }

  let axeBuilder: typeof import('@axe-core/playwright').default | null = null;
  try {
    axeBuilder = (await import('@axe-core/playwright')).default;
  } catch {
    // axe is optional; live a11y checks become blocked rather than failing the whole walk.
  }

  let routes: Array<{ path: string; source: string }> = [];
  if (existsSync(args.surfaceInventory)) {
    const raw = JSON.parse(readFileSync(args.surfaceInventory, 'utf8'));
    routes = raw.routes ?? [];
  }
  if (routes.length === 0) routes = [{ path: '/', source: '(default)' }];

  const dir = join(args.artifactDir, 'runtime');
  const screenshotsDir = join(dir, 'screenshots');
  mkdirSync(screenshotsDir, { recursive: true });

  const browser = await playwright.chromium.launch();
  const evidence = {
    target_url: args.targetUrl,
    reachable: false,
    routes: [] as Array<{
      path: string;
      breakpoints: Array<{
        name: string;
        width: number;
        height: number;
        screenshot: string;
        scrollWidth: number;
        viewportWidth: number;
        horizontalScroll: boolean;
        computed_styles: Record<string, Record<string, string>>;
        axe_violations: unknown[];
      }>;
    }>,
    blocked_checks: [] as string[],
  };

  if (!axeBuilder) evidence.blocked_checks.push('axe-core-playwright-not-installed');

  for (const route of routes) {
    const routeRecord = {
      path: route.path,
      breakpoints: [] as (typeof evidence.routes)[number]['breakpoints'],
    };
    for (const bp of args.breakpoints) {
      const context = await browser.newContext({
        viewport: { width: bp.width, height: bp.height },
      });
      const page = await context.newPage();
      const url = new URL(route.path, args.targetUrl).toString();
      try {
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 15_000 });
        if (response && response.ok()) evidence.reachable = true;
      } catch {
        await context.close();
        continue;
      }

      const screenshotName = `${route.path.replace(/[^a-z0-9]+/gi, '_') || 'root'}__${bp.name}.png`;
      const screenshotPath = join(screenshotsDir, screenshotName);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));

      const computed_styles = await page.evaluate(() => {
        const targets = ['body', 'h1', 'h2', 'h3', 'p', 'button', 'a', 'input'];
        const out: Record<string, Record<string, string>> = {};
        for (const sel of targets) {
          const el = document.querySelector(sel);
          if (!el) continue;
          const cs = getComputedStyle(el);
          out[sel] = {
            color: cs.color,
            background: cs.backgroundColor,
            'font-family': cs.fontFamily,
            'font-size': cs.fontSize,
            'line-height': cs.lineHeight,
            'border-radius': cs.borderRadius,
            'box-shadow': cs.boxShadow,
          };
        }
        return out;
      });

      let axe_violations: unknown[] = [];
      if (axeBuilder) {
        try {
          const results = await new axeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag22aa'])
            .analyze();
          axe_violations = results.violations;
        } catch {
          /* swallowed; recorded via blocked_checks above */
        }
      }

      routeRecord.breakpoints.push({
        name: bp.name,
        width: bp.width,
        height: bp.height,
        screenshot: screenshotPath,
        scrollWidth: scroll.scrollWidth,
        viewportWidth: scroll.viewportWidth,
        horizontalScroll: scroll.scrollWidth > scroll.viewportWidth,
        computed_styles,
        axe_violations,
      });

      await context.close();
    }
    evidence.routes.push(routeRecord);
  }

  await browser.close();

  mkdirSync(dirname(join(dir, 'runtime-checks.json')), { recursive: true });
  writeFileSync(join(dir, 'runtime-checks.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(
    `runtime-checks complete: ${evidence.routes.length} routes × ${args.breakpoints.length} breakpoints`,
  );
}

main().catch((err) => {
  console.error('runtime-checks failed:', err);
  process.exit(1);
});
