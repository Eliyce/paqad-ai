import { createHash } from 'node:crypto';

import type { DetectionReport } from '@/core/types/health.js';

export interface StackDetectionPermissions {
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
}

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
  projectRoot?: string;
  permissions?: Partial<StackDetectionPermissions>;
}

const ID_SEED_SEPARATOR = '::';

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

function toHumanTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp;
  }
  const iso = parsed.toISOString();
  const [date, time] = iso.split('T');
  return `${date} ${time.slice(0, 5)} UTC`;
}
