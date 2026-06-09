import { createHash } from 'node:crypto';

import type { DetectionReport } from '@/core/types/health.js';

/**
 * PQD-423: the `ModelResource` envelope permissions block. Kept at the IPC
 * boundary (this wrapper) rather than on the internal {@link DetectionReport}.
 */
export interface StackDetectionPermissions {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

/**
 * PQD-423: a {@link DetectionReport} wrapped in the seven mandatory `ModelResource`
 * envelope fields that every desktop/API response carries. This keeps the envelope
 * shape at the engine edge so internal detection types stay lean.
 */
export interface StackDetectionResource {
  id: string;
  type: 'stack_detection';
  created_at: string;
  updated_at: string;
  created_at_human: string;
  updated_at_human: string;
  permissions: StackDetectionPermissions;
  report: DetectionReport;
}

export interface ToStackDetectionResourceOptions {
  /** Project folder the report was produced for; folded into the stable `id`. */
  projectRoot?: string;
  /** Override any of the default permissions (view-only by default). */
  permissions?: Partial<StackDetectionPermissions>;
}

/** Separator between the project root and timestamp in the id seed. */
const ID_SEED_SEPARATOR = '::';

/**
 * Wrap a {@link DetectionReport} in the `ModelResource` envelope.
 *
 * The `id` is a deterministic SHA-256 of `projectRoot + report.timestamp`, so two
 * envelopes built from the same report (same folder, same detection run) share an
 * identical id. Human timestamps are formatted deterministically in UTC — no
 * locale or machine-timezone dependence — so the result is reproducible.
 */
export function toStackDetectionResource(
  report: DetectionReport,
  options: ToStackDetectionResourceOptions = {},
): StackDetectionResource {
  const timestamp = report.timestamp;
  const id = createHash('sha256')
    .update(`${options.projectRoot ?? ''}${ID_SEED_SEPARATOR}${timestamp}`)
    .digest('hex');
  const human = toHumanTimestamp(timestamp);

  return {
    id,
    type: 'stack_detection',
    created_at: timestamp,
    updated_at: timestamp,
    created_at_human: human,
    updated_at_human: human,
    permissions: {
      can_view: options.permissions?.can_view ?? true,
      can_edit: options.permissions?.can_edit ?? false,
      can_delete: options.permissions?.can_delete ?? false,
    },
    report,
  };
}

/**
 * Deterministic `YYYY-MM-DD HH:MM UTC` rendering of an ISO-8601 timestamp. Falls
 * back to the raw input when it is not a parseable date so the envelope never throws.
 */
function toHumanTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  const iso = parsed.toISOString();
  const [date, time] = iso.split('T');
  return `${date} ${time.slice(0, 5)} UTC`;
}
