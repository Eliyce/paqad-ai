// The generic workflow-preflight contract (issue: site-map rebuild S3a, fixing D5/D6).
//
// Before a workflow does any real work, it should check everything the run needs and put every
// unanswered question to the person in ONE interruption, instead of discovering gaps late and
// degrading silently. This module is the workflow-agnostic shape that makes that possible: a
// requirement declares what it needs and how to ask about it, a probe reports whether the need is
// met, and the runner (run.ts) turns the unmet ones into a single batched question set. Nothing
// here is site-map-specific — the site-map requirements live in the site-map module and register
// through registry.ts, so any other workflow can add its own requirements without touching the
// runner.

/**
 * What a probe found. `ok` means the requirement is met and nothing needs asking; `unavailable`
 * means the thing the run needs is not present; `needs-decision` means it is present but there is a
 * choice for the person to make (for example: a project command exists and could be run, but
 * whether paqad runs it is a decision — see DEC-1).
 */
export type ProbeOutcome = 'ok' | 'unavailable' | 'needs-decision';

/** The kind of thing a requirement is about, so the summary can word it for a person. */
export type RequirementKind = 'command' | 'file' | 'workflow';

/** One answer the person can pick when a requirement is not `ok`. */
export interface PreflightOption {
  /** Stable id of the choice, recorded as the answer. */
  id: string;
  /** Plain-language label shown to the person. */
  label: string;
  /** True on the option paqad recommends, so the person can accept it quickly. */
  recommended?: boolean;
}

/**
 * A single thing a workflow needs before it runs. Declared once in a registry; the runner probes
 * it and, when it is not `ok`, asks the person using `options`.
 */
export interface PreflightRequirement {
  /** Stable identity of the requirement; the persisted answer keys off it. */
  id: string;
  /** Plain-language name of what is needed. */
  label: string;
  /** Whether the need is a command, a file, or another workflow having run first. */
  kind: RequirementKind;
  /**
   * A plain-language sentence saying what the run loses without this, in the paqad voice: no
   * jargon, no em dashes.
   */
  why: string;
  /**
   * A read-only check of whether the need is met. It MUST NOT execute project code that boots the
   * application; it may check that a file exists or that a binary answers `--version`. Anything
   * that boots the app is exactly what a preflight question is for, so the person decides it first.
   */
  probe: (projectRoot: string) => Promise<ProbeOutcome>;
  /**
   * Optional project gate. When present and it returns `false` for this project, the requirement
   * is not declared for the run at all: it is never probed and never becomes a question. Used for a
   * requirement that only makes sense on some stacks (for example a Laravel route list on a Laravel
   * project). A requirement with no `applies` is always declared.
   */
  applies?: (projectRoot: string) => boolean;
  /** What to ask when the probe does not come back `ok`. */
  options: PreflightOption[];
}

/** A requirement after its probe has run: the declaration plus the outcome the probe reported. */
export interface PreflightRequirementResult {
  id: string;
  label: string;
  kind: RequirementKind;
  why: string;
  outcome: ProbeOutcome;
  options: PreflightOption[];
}

/**
 * One thing the person still has to answer: a requirement whose probe came back `unavailable` or
 * `needs-decision`. Every question in a run is asked together, so the person is interrupted once.
 */
export interface PreflightQuestion {
  id: string;
  label: string;
  why: string;
  outcome: Exclude<ProbeOutcome, 'ok'>;
  options: PreflightOption[];
}

/**
 * The result of a preflight: every requirement's outcome, the subset that still needs answering
 * (in declaration order), and whether the run may proceed (`ok` is true only when nothing is left
 * to ask).
 */
export interface PreflightResult {
  ok: boolean;
  requirements: PreflightRequirementResult[];
  questions: PreflightQuestion[];
}
