import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { Command } from 'commander';

import {
  buildBoundaryReport,
  buildPatternAdvisories,
  checkSpecCompliance,
  DEFAULT_OBLIGATION_INDEX_PATH,
  doctorBoundaryReport,
  doctorObligationIndex,
  doctorSpecReview,
  extractObligationIndex,
  generateBoundaryTests,
  generateVitestSkeletons,
  loadBoundaryReport,
  loadObligationIndex,
  loadSpecReviewReport,
  prunePatterns,
  queryPatterns,
  reviewSpecification,
  saveBoundaryReport,
  saveObligationIndex,
  saveSpecReviewReport,
  scanBoundaries,
  specIndexPath,
  specReportPath,
} from '@/compliance/index.js';

function resolveIndexPath(explicitPath: string | undefined, spec: string | undefined): string {
  if (explicitPath) return explicitPath;
  if (spec) return specIndexPath(spec);
  return DEFAULT_OBLIGATION_INDEX_PATH;
}

export function formatSpecReviewSummary(report: ReturnType<typeof reviewSpecification>): string {
  const activeDefects = report.defects.filter((defect) => defect.status !== 'resolved');
  const lines = [
    `Spec Review — ${report.metadata.spec_file}`,
    `Reviewed: ${report.metadata.reviewed_at}`,
    '',
    `Open defects: ${activeDefects.length}`,
  ];

  if (activeDefects.length > 0) {
    lines.push('');
    lines.push('Findings:');
    for (const defect of activeDefects) {
      const location = defect.locations[0];
      lines.push(
        `  [${defect.severity}] ${defect.category} at ${location?.section ?? 'Spec'}:${location?.line_range[0] ?? 0} — ${defect.description}`,
      );
    }
  }

  const resolved = report.defects.filter((defect) => defect.status === 'resolved');
  if (resolved.length > 0) {
    lines.push('');
    lines.push(`Resolved findings carried forward: ${resolved.length}`);
  }

  return lines.join('\n');
}

export function createComplianceCommand(): Command {
  const command = new Command('compliance').description('Spec compliance verification tools');

  command
    .command('extract')
    .description('Extract obligations from a spec and persist an obligation index')
    .requiredOption('--spec <path>', 'Markdown spec file path (relative to project root)')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option(
      '--index-path <path>',
      'Index output path (default: .paqad/compliance/{spec-slug}/obligations.json)',
    )
    .action(async (options: { spec: string; projectRoot: string; indexPath?: string }) => {
      const indexPath = resolveIndexPath(options.indexPath, options.spec);
      const specPath = path.resolve(options.projectRoot, options.spec);
      const relativeSpec = path.relative(options.projectRoot, specPath);
      const specMarkdown = await readFile(specPath, 'utf8');
      const review = await loadSpecReviewReport({
        project_root: options.projectRoot,
        spec_file: relativeSpec,
      });
      const index = extractObligationIndex({
        spec_file: relativeSpec,
        spec_markdown: specMarkdown,
        spec_review: review,
      });
      await saveObligationIndex({
        project_root: options.projectRoot,
        index_path: indexPath,
        index,
      });
      console.log(JSON.stringify(index, null, 2));
      process.exitCode = 0;
    });

  command
    .command('review <specFile>')
    .description('Run deterministic spec-quality review and persist the review report')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--json', 'Print JSON instead of a human-readable summary')
    .action(async (specFile: string, options: { projectRoot: string; json?: boolean }) => {
      const specPath = path.resolve(options.projectRoot, specFile);
      const relativeSpec = path.relative(options.projectRoot, specPath);
      const specMarkdown = await readFile(specPath, 'utf8');
      const previousReport = await loadSpecReviewReport({
        project_root: options.projectRoot,
        spec_file: relativeSpec,
      });
      const report = reviewSpecification({
        spec_file: relativeSpec,
        spec_markdown: specMarkdown,
        previous_report: previousReport,
      });
      report.pattern_advisories = await buildPatternAdvisories({
        min_frequency: 1,
        max_age_days: 365,
        storeRoot: resolvePatternStoreRoot(options.projectRoot),
      });

      await saveSpecReviewReport({
        project_root: options.projectRoot,
        spec_file: relativeSpec,
        report,
      });

      console.log(options.json ? JSON.stringify(report, null, 2) : formatSpecReviewSummary(report));
      process.exitCode = 0;
    });

  command
    .command('check')
    .description('Check project tests for obligation coverage')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--spec <path>', 'Spec file — used to auto-derive index and report paths')
    .option('--index-path <path>', 'Explicit index path (overrides --spec derivation)')
    .option('--gate', 'Apply compliance gate thresholds and exit non-zero if not met')
    .option('--min-ratio <n>', 'Minimum compliance ratio required (with --gate)', '0.9')
    .option(
      '--max-uncovered-critical <n>',
      'Maximum uncovered acceptance/edge-case obligations (with --gate)',
      '0',
    )
    .action(
      async (options: {
        projectRoot: string;
        spec?: string;
        indexPath?: string;
        gate?: boolean;
        minRatio: string;
        maxUncoveredCritical: string;
      }) => {
        const indexPath = resolveIndexPath(options.indexPath, options.spec);
        const relativeSpec = resolveRelativeSpec(options.projectRoot, options.spec);
        const reportPath = relativeSpec ? specReportPath(relativeSpec) : undefined;
        const review =
          relativeSpec === undefined
            ? null
            : await loadSpecReviewReport({
                project_root: options.projectRoot,
                spec_file: relativeSpec,
              });

        const index = await loadObligationIndex({
          project_root: options.projectRoot,
          index_path: indexPath,
        });
        const doctor = doctorObligationIndex(index);
        if (!doctor.ok || !index) {
          console.log(JSON.stringify(doctor, null, 2));
          process.exitCode = 1;
          return;
        }

        const report = await checkSpecCompliance({
          project_root: options.projectRoot,
          index,
          report_path: reportPath,
          spec_review: review,
        });

        if (options.gate) {
          const minRatio = parseFloat(options.minRatio);
          const maxUncoveredCritical = parseInt(options.maxUncoveredCritical, 10);
          const criticalCategories = new Set(['acceptance', 'edge-case']);
          const uncoveredCriticalCount = report.obligations.filter(
            (obligation) =>
              obligation.state === 'uncovered' && criticalCategories.has(obligation.category),
          ).length;

          const failed =
            report.summary.compliance_ratio < minRatio ||
            uncoveredCriticalCount > maxUncoveredCritical;

          console.log(
            JSON.stringify(
              {
                gate_result: failed ? 'fail' : 'pass',
                compliance_ratio: report.summary.compliance_ratio,
                uncovered_count: report.summary.uncovered,
                uncovered_critical_count: uncoveredCriticalCount,
                uncovered_ids: report.uncovered_obligations,
                min_ratio_threshold: minRatio,
                max_uncovered_critical_threshold: maxUncoveredCritical,
                spec_defect_count: report.spec_review?.defect_count ?? 0,
                spec_defect_warning: report.spec_review?.warning ?? null,
              },
              null,
              2,
            ),
          );
          process.exitCode = failed ? 1 : 0;
          return;
        }

        console.log(JSON.stringify(report, null, 2));
        process.exitCode = report.summary.uncovered > 0 ? 1 : 0;
      },
    );

  command
    .command('skeleton')
    .description(
      'Generate failing test skeletons for uncovered and partial obligations (Vitest). ' +
        'Runs a compliance check first and skips already-covered obligations unless --all is set.',
    )
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--spec <path>', 'Spec file — used to auto-derive index path')
    .option('--index-path <path>', 'Explicit index path (overrides --spec derivation)')
    .option('--out <path>', 'Output directory', 'tests/compliance-skeletons')
    .option('--all', 'Generate stubs for all obligations, not just uncovered and partial')
    .action(
      async (options: {
        projectRoot: string;
        spec?: string;
        indexPath?: string;
        out: string;
        all?: boolean;
      }) => {
        const indexPath = resolveIndexPath(options.indexPath, options.spec);
        const relativeSpec = resolveRelativeSpec(options.projectRoot, options.spec);

        const index = await loadObligationIndex({
          project_root: options.projectRoot,
          index_path: indexPath,
        });
        const doctor = doctorObligationIndex(index);
        if (!doctor.ok || !index) {
          console.log(JSON.stringify(doctor, null, 2));
          process.exitCode = 1;
          return;
        }

        const review =
          relativeSpec === undefined
            ? null
            : await loadSpecReviewReport({
                project_root: options.projectRoot,
                spec_file: relativeSpec,
              });

        let obligations = index.obligations;
        if (!options.all) {
          const report = await checkSpecCompliance({
            project_root: options.projectRoot,
            index,
            spec_review: review,
          });
          const skeletonStates = new Set(['uncovered', 'partial']);
          const activeIds = new Set(
            report.obligations
              .filter((obligation) => skeletonStates.has(obligation.state))
              .map((obligation) => obligation.obligation_id),
          );
          obligations = index.obligations.filter((obligation) =>
            activeIds.has(obligation.obligation_id),
          );
        }

        const written = await generateVitestSkeletons({
          project_root: options.projectRoot,
          obligations,
          output_dir: options.out,
        });
        console.log(JSON.stringify({ written }, null, 2));
        process.exitCode = 0;
      },
    );

  command
    .command('report')
    .description('Print a human-readable compliance report')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--spec <path>', 'Spec file — used to auto-derive index path')
    .option('--index-path <path>', 'Explicit index path (overrides --spec derivation)')
    .action(async (options: { projectRoot: string; spec?: string; indexPath?: string }) => {
      const indexPath = resolveIndexPath(options.indexPath, options.spec);
      const relativeSpec = resolveRelativeSpec(options.projectRoot, options.spec);

      const index = await loadObligationIndex({
        project_root: options.projectRoot,
        index_path: indexPath,
      });
      const doctor = doctorObligationIndex(index);
      if (!doctor.ok || !index) {
        console.log(JSON.stringify(doctor, null, 2));
        process.exitCode = 1;
        return;
      }

      const review =
        relativeSpec === undefined
          ? null
          : await loadSpecReviewReport({
              project_root: options.projectRoot,
              spec_file: relativeSpec,
            });
      const report = await checkSpecCompliance({
        project_root: options.projectRoot,
        index,
        spec_review: review,
      });
      const lines: string[] = [];

      lines.push(`Compliance Report — ${report.metadata.spec_file}`);
      lines.push(`Generated: ${report.metadata.generated_at}`);
      lines.push('');
      lines.push('Summary');
      lines.push(`  Total obligations:   ${report.summary.total}`);
      lines.push(`  Covered:             ${report.summary.covered}`);
      lines.push(`  Partial:             ${report.summary.partial}`);
      lines.push(`  Uncovered:           ${report.summary.uncovered}`);
      lines.push(`  Indeterminate:       ${report.summary.indeterminate}`);
      lines.push(`  Compliance ratio:    ${(report.summary.compliance_ratio * 100).toFixed(1)}%`);
      if (report.spec_review) {
        lines.push(`  Spec defects:        ${report.spec_review.defect_count}`);
        if (report.spec_review.warning) {
          lines.push(`  Warning:             ${report.spec_review.warning}`);
        }
      }

      const uncovered = report.obligations.filter((obligation) => obligation.state === 'uncovered');
      if (uncovered.length > 0) {
        lines.push('');
        lines.push('Uncovered obligations:');
        for (const obligation of uncovered) {
          lines.push(`  [${obligation.obligation_id}] ${obligation.description}`);
          if (obligation.pass_criteria)
            lines.push(`    Pass criteria: ${obligation.pass_criteria}`);
        }
      }

      const partial = report.obligations.filter((obligation) => obligation.state === 'partial');
      if (partial.length > 0) {
        lines.push('');
        lines.push('Partial obligations:');
        for (const obligation of partial) {
          lines.push(`  [${obligation.obligation_id}] ${obligation.description}`);
        }
      }

      console.log(lines.join('\n'));
      process.exitCode = report.summary.uncovered > 0 ? 1 : 0;
    });

  command
    .command('doctor')
    .description('Validate obligation index health')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--spec <path>', 'Spec file — used to auto-derive index path')
    .option('--index-path <path>', 'Explicit index path (overrides --spec derivation)')
    .action(async (options: { projectRoot: string; spec?: string; indexPath?: string }) => {
      const indexPath = resolveIndexPath(options.indexPath, options.spec);
      const relativeSpec = resolveRelativeSpec(options.projectRoot, options.spec);

      const index = await loadObligationIndex({
        project_root: options.projectRoot,
        index_path: indexPath,
      });
      const obligationDoctor = doctorObligationIndex(index);
      const review =
        relativeSpec === undefined
          ? null
          : await loadSpecReviewReport({
              project_root: options.projectRoot,
              spec_file: relativeSpec,
            });
      const reviewDoctor = doctorSpecReview(review, {
        spec_is_newer: await isSpecReviewStale(
          options.projectRoot,
          relativeSpec,
          review?.metadata.reviewed_at,
        ),
      });

      const boundaryReport = await loadBoundaryReport(options.projectRoot);
      const boundaryIssues = doctorBoundaryReport(boundaryReport);

      const result = {
        ok: obligationDoctor.ok && reviewDoctor.ok && boundaryIssues.ok,
        issues: [...obligationDoctor.issues, ...reviewDoctor.issues, ...boundaryIssues.issues],
      };

      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    });

  // ── compliance boundary ──────────────────────────────────────────────────
  command
    .command('boundary')
    .description('Detect shared-type boundaries across specs and report unhandled variants')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--generate', 'Generate test stubs for unhandled variants')
    .option('--json', 'Print JSON instead of human-readable output')
    .action(async (options: { projectRoot: string; generate?: boolean; json?: boolean }) => {
      const results = await scanBoundaries({ project_root: options.projectRoot });
      const report = buildBoundaryReport(results);
      await saveBoundaryReport(report, options.projectRoot);

      if (options.generate) {
        for (const result of results) {
          const allUnhandled = [...result.unhandled_by_consumer.values()].flat();
          await generateBoundaryTests({
            project_root: options.projectRoot,
            boundary: result.boundary,
            unhandled: allUnhandled,
          });
        }
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatBoundaryReport(report));
      }
      process.exitCode = 0;
    });

  // ── compliance patterns ───────────────────────────────────────────────────
  command
    .command('patterns')
    .description('List, prune, or export defect patterns from the pattern store')
    .option('--project-root <path>', 'Project root', process.cwd())
    .option('--prune [days]', 'Remove patterns older than N days (default 365)')
    .option('--export <path>', 'Export patterns to a file')
    .option('--format <fmt>', 'Export format: json | markdown (default json)', 'json')
    .option('--min-frequency <n>', 'Minimum frequency to include (default 1)', '1')
    .action(
      async (options: {
        projectRoot: string;
        prune?: string | boolean;
        export?: string;
        format: string;
        minFrequency: string;
      }) => {
        const storeRoot = resolvePatternStoreRoot(options.projectRoot);
        if (options.prune !== undefined) {
          const days = typeof options.prune === 'string' ? parseInt(options.prune, 10) : 365;
          const removed = await prunePatterns(days, storeRoot);
          console.log(JSON.stringify({ pruned: removed }, null, 2));
          process.exitCode = 0;
          return;
        }

        const patterns = await queryPatterns(
          {
            min_frequency: parseInt(options.minFrequency, 10),
            max_age_days: 36500, // effectively no age filter for listing
          },
          storeRoot,
        );

        if (options.export) {
          const content =
            options.format === 'markdown'
              ? formatPatternsAsMarkdown(patterns)
              : JSON.stringify(patterns, null, 2);
          const { writeFile: wf } = await import('node:fs/promises');
          await wf(options.export, content + '\n', 'utf8');
          console.log(
            JSON.stringify({ exported: options.export, count: patterns.length }, null, 2),
          );
        } else {
          console.log(JSON.stringify(patterns, null, 2));
        }
        process.exitCode = 0;
      },
    );

  return command;
}

export function formatBoundaryReport(report: ReturnType<typeof buildBoundaryReport>): string {
  const lines = [
    `Boundary Report`,
    `Generated: ${report.metadata.generated_at}`,
    '',
    `Total interfaces:  ${report.total_interfaces}`,
    `Total states:      ${report.total_states}`,
    `Handled:           ${report.handled_count}`,
    `Unhandled:         ${report.unhandled_count}`,
    `Gate result:       ${report.gate_result.toUpperCase()}`,
  ];

  for (const iface of report.interfaces) {
    if (iface.unhandled_variants.length > 0) {
      lines.push('');
      lines.push(`  ${iface.type_name} (${iface.file})`);
      for (const v of iface.unhandled_variants) {
        lines.push(
          `    [unhandled] state "${v.state}" not referenced by consumer ${v.consumer_spec}`,
        );
      }
    }
  }

  return lines.join('\n');
}

function formatPatternsAsMarkdown(patterns: Awaited<ReturnType<typeof queryPatterns>>): string {
  if (patterns.length === 0) return '# Defect Patterns\n\nNo patterns recorded.\n';
  const lines = ['# Defect Patterns', ''];
  for (const p of patterns) {
    lines.push(`## ${p.subcategory}`);
    lines.push(`**Frequency:** ${p.frequency}  **Last seen:** ${p.last_seen}`);
    lines.push('');
    lines.push(p.description);
    lines.push('');
  }
  return lines.join('\n');
}

async function isSpecReviewStale(
  projectRoot: string,
  spec: string | undefined,
  reviewedAt: string | undefined,
): Promise<boolean> {
  if (!spec || !reviewedAt) return false;

  try {
    const specPath = path.resolve(projectRoot, spec);
    const stats = await stat(specPath);
    return stats.mtimeMs > new Date(reviewedAt).getTime();
  } catch {
    return false;
  }
}

function resolvePatternStoreRoot(projectRoot: string): string {
  return path.resolve(projectRoot, '.paqad', 'defect-patterns');
}

function resolveRelativeSpec(projectRoot: string, spec: string | undefined): string | undefined {
  if (!spec) return undefined;
  const specPath = path.resolve(projectRoot, spec);
  return path.relative(projectRoot, specPath);
}
