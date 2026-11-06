const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

export function formatAge(from: string, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - Date.parse(from));
  if (elapsed < MINUTE) return 'less than a minute';
  if (elapsed < HOUR) return plural(Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return plural(Math.floor(elapsed / HOUR), 'hour');
  return plural(Math.floor(elapsed / DAY), 'day');
}

export function formatDay(at: string): string {
  const date = new Date(at);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export const FREEZE_NEXT_LINE = '> - 🟡 next: write the high-level design. Run paqad-ai hld brief.';

export const FREEZE_NEXT_V2_LINE =
  '> - 🟡 next: update the high-level design. Run paqad-ai hld brief; it goes out as v2 on the same comment.';

export const V2_PREFIX = 'v2, replaces the comment above';

export function postedWaitingLine(ref: string): string {
  return `Posted the high-level design to ${ref}. The build starts once it's signed off there. You can work on something else meanwhile.`;
}

export function postedInfoLine(ref: string): string {
  return `Posted the high-level design to ${ref} for the team to read. Carrying on with the build.`;
}

export function approvedLine(ref: string, at: string): string {
  return `The high-level design for ${ref} was approved on ${formatDay(at)}. Starting the build.`;
}

export function changesRequestedLine(ref: string): string {
  return `There's a reply on the high-level design for ${ref} asking for changes. Here it is, so we can update the spec:`;
}

export function stillWaitingLine(ref: string, age: string): string {
  return `No answer on the high-level design for ${ref} yet (posted ${age} ago).`;
}

export function notConnectedLine(target: string): string {
  return `I couldn't post the high-level design: ${target} isn't connected. It's in chat for you to share. Connect ${target} to post it automatically next time.`;
}

export function gateBlockLine(ref: string, allowSkip: boolean): string {
  return allowSkip
    ? `The high-level design for ${ref} is waiting for sign-off. Check for an answer with paqad-ai hld check-approval, or skip with paqad-ai hld skip --reason "<why>".`
    : `The high-level design for ${ref} is waiting for sign-off. Check for an answer with paqad-ai hld check-approval. The build starts only once an approver answers there.`;
}

export const GATE_NO_DESIGN_LINE =
  "The high-level design for this change hasn't been written yet. Write it and record it first: run paqad-ai hld brief, then paqad-ai hld posted or paqad-ai hld not-posted.";

export function sessionWaitingLine(ref: string, age: string): string {
  return `${ref} is waiting for high-level design sign-off (posted ${age} ago).`;
}

export function resumeLine(ref: string): string {
  return `Resumed the change for ${ref}, which is waiting for high-level design sign-off. Run paqad-ai hld check-approval first.`;
}

export function prSignedOffLine(ref: string, at: string, link: string): string {
  return `High-level design signed off in ${ref} on ${formatDay(at)} (${link}).`;
}

export function prSkippedLine(reason: string): string {
  return `Built before high-level design sign-off. Reason: ${reason.trim().replace(/\.$/u, '')}.`;
}

export function receiptSignedOffLine(link: string): string {
  return `🟢 High-level design signed off (${link})`;
}

export const RECEIPT_POSTED_LINE = '🟡 posted, not signed off';
export const RECEIPT_OFF_LINE = '⚪ off for this team';

export function receiptSkippedLine(reason: string): string {
  return `🟡 High-level design skipped before sign-off. Reason: ${reason.trim().replace(/\.$/u, '')}.`;
}

export const RECEIPT_NOT_POSTED_LINE = '🟡 High-level design not posted, shared in chat';

export function detailMissingLine(ref: string): string {
  return `The More detail part of the high-level design for ${ref} didn't post. It will be added to the same thread next time; the design still waits for sign-off.`;
}

export function moveFailedLine(ref: string, status: string): string {
  return `Couldn't move ${ref} to "${status}". The design is posted and still waits for sign-off.`;
}

export function startedOverLine(ref: string): string {
  return `Updated the high-level design for ${ref} to v2. Approval starts over, so earlier replies no longer count.`;
}

export function alreadyRecordedLine(ref: string, target: string): string {
  return `This version of the high-level design for ${ref} is already recorded as posted to ${target}. Nothing to post again.`;
}

export function skippedLine(ref: string): string {
  return `Skipped high-level design sign-off for ${ref}. Post the reason back to the team where the design was posted.`;
}

export const SKIP_NOT_ALLOWED_LINE =
  "This team doesn't allow building before sign-off (allow_skip_with_reason is false in design-sign-off.yaml). Wait for an approver to answer.";

export const SKIP_NEEDS_REASON_LINE =
  'Give a reason to skip sign-off: paqad-ai hld skip --reason "<why>".';
