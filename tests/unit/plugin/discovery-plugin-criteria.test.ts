import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { findPython } from '../../../scripts/build-discovery.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PLUGIN = join(repoRoot, 'plugins', 'discovery');
const TIMEOUT = 180_000;

let python = '';

beforeAll(() => {
  python = findPython().command;
});

function runPluginTests(names: string[]): void {
  const run = spawnSync(
    python,
    ['-m', 'unittest', ...names.map((name) => `tests.scripts.${name}`)],
    {
      cwd: PLUGIN,
      encoding: 'utf8',
      timeout: TIMEOUT,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    },
  );
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  expect(run.error, output).toBeUndefined();
  expect(run.status, output).toBe(0);
  expect(output).toContain(`Ran ${names.length} test`);
  expect(output).not.toMatch(/skipped=/);
}

const CRITERIA: Array<[string, string, string[]]> = [
  [
    'AC-2',
    'the discovery build holds both manifest sets and refuses an unknown target',
    [
      'test_build_flags.TargetBuildTest.test_ac2_discovery_root_holds_both_manifest_sets_and_the_eleven_skills',
      'test_build_flags.TargetConfigTest.test_ac2_an_unknown_or_empty_target_fails',
    ],
  ],
  [
    'AC-9',
    'the published start skill says the one plugin sentence once and offers ask or discover',
    [
      'test_build_flags.TargetBuildTest.test_ac8_ac9_discovery_start_says_the_sentence_once_and_offers_ask_or_discover',
    ],
  ],
  [
    'AC-10',
    'both plugin manifests are named paqad and the marketplace keeps its name',
    [
      'test_build.ListingManifestTest.test_ac10_both_plugin_manifests_are_named_paqad_and_the_marketplace_keeps_its_name',
    ],
  ],
  [
    'AC-19',
    'the readmes open with the one plugin sentence',
    ['test_build.PublishFilesTest.test_ac19_readmes_open_with_the_one_plugin_sentence'],
  ],
  [
    'AC-20',
    'one clear ticket prefix is recommended after one check read',
    [
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac20_one_clear_prefix_is_recommended_with_the_sentence_after_one_check',
    ],
  ],
  [
    'AC-21',
    'no ticket keys means the project is asked for and recorded as asked',
    ['test_tracker_grounding.StepZeroProjectScanTest.test_ac21_no_keys_asks_and_records_asked'],
  ],
  [
    'AC-22',
    'the ticket key scan uppercases keys, drops ignored prefixes and counts GitHub refs apart',
    [
      'test_find_ticket_keys.ScanTest.test_ac22_mixed_case_branches_are_uppercased',
      'test_find_ticket_keys.ScanTest.test_ac22_every_ignored_prefix_is_dropped',
      'test_find_ticket_keys.ScanTest.test_ac26_ties_go_to_the_prefix_on_the_newer_line',
      'test_find_ticket_keys.ScanTest.test_ac22_github_only_refs_are_counted_apart',
    ],
  ],
  [
    'AC-23',
    'a prefix with enough hits and twice the next one is clear',
    ['test_find_ticket_keys.VerdictTest.test_ac23_the_clear_prefix_rule'],
  ],
  [
    'AC-24',
    'a prefix with only one or two hits is asked about, not recommended',
    [
      'test_find_ticket_keys.VerdictTest.test_ac24_one_prefix_with_one_or_two_hits_is_asked',
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac24_ac25_a_prefix_below_the_floor_is_a_plain_choice',
    ],
  ],
  [
    'AC-25',
    'version words and prefixes below the floor are never recommended',
    [
      'test_find_ticket_keys.ScanTest.test_ac25_version_words_stay_below_the_floor',
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac24_ac25_a_prefix_below_the_floor_is_a_plain_choice',
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac28_a_failed_check_read_asks_without_a_broad_search',
    ],
  ],
  [
    'AC-26',
    'a tie between prefixes goes to the one on the newer line',
    ['test_find_ticket_keys.ScanTest.test_ac26_ties_go_to_the_prefix_on_the_newer_line'],
  ],
  [
    'AC-27',
    'the saved scan keeps counts only and never example keys or text',
    [
      'test_check_record.TicketKeyScanTest.test_ac27_a_scan_with_counts_only_passes',
      'test_check_record.TicketKeyScanTest.test_ac27_a_scan_carrying_examples_or_text_is_refused',
      'test_check_record.TicketKeyScanTest.test_ac27_the_scan_output_passes_once_its_examples_are_dropped',
      'test_check_record.TicketKeyScanTest.test_ac27_the_skill_and_reference_say_to_drop_examples_before_recording',
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac27_the_record_keeps_counts_only',
    ],
  ],
  [
    'AC-28',
    'a failed check read asks for the project without a broad search',
    [
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac28_a_failed_check_read_asks_without_a_broad_search',
    ],
  ],
  [
    'AC-29',
    'every project prompt offers a different project',
    [
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac29_every_prompt_offers_a_different_project',
    ],
  ],
  [
    'AC-31',
    'a list that is cut short still scans the lines it read',
    [
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac31_a_cut_short_list_still_scans_the_lines_read',
    ],
  ],
  [
    'AC-33',
    'with no repository the ticket key scan is skipped',
    ['test_tracker_grounding.StepZeroProjectScanTest.test_ac33_no_repository_skips_the_scan'],
  ],
  [
    'AC-35',
    'the code settles what the business notes cannot',
    [
      'test_evidence_rules.BusinessDocsFirstTest.test_ac35_code_settles_what_the_business_notes_cannot',
      'test_evidence_rules.BusinessDocsFirstTest.test_ac34_ac35_the_fixture_and_scenarios_cover_both_cases',
    ],
  ],
  [
    'AC-36',
    'the playback opens with the comparison lines',
    [
      'test_tracker_grounding.CompareStepTest.test_ac36_the_playback_opens_with_the_comparison_lines',
    ],
  ],
  [
    'AC-37',
    'each comparison mark has its own line',
    ['test_tracker_grounding.CompareStepTest.test_ac37_each_mark_has_its_line'],
  ],
  [
    'AC-38',
    'a run with one source shows no comparison',
    ['test_tracker_grounding.CompareStepTest.test_ac38_one_source_runs_show_no_comparison'],
  ],
  [
    'AC-40',
    'the record check accepts the four marks and older records, and refuses any other mark',
    [
      'test_check_record.TicketKeyScanTest.test_ac40_a_record_without_the_new_setup_fields_still_passes',
      'test_check_record.ComparisonTest.test_ac40_the_four_marks_pass',
      'test_check_record.ComparisonTest.test_ac40_any_other_mark_fails_naming_the_entry',
      'test_check_record.ComparisonTest.test_ac40_an_older_record_without_comparison_still_passes',
    ],
  ],
  [
    'AC-41',
    'an unreadable repository connector is named once and only the idea journey goes on from the tickets',
    [
      'test_tracker_grounding.UnreadableConnectorTest.test_ac41_the_sentence_is_said_once_and_the_run_goes_on_tracker_only',
      'test_tracker_grounding.UnreadableConnectorTest.test_ac41_only_the_idea_journey_goes_on_tracker_only_and_ask_stops',
    ],
  ],
  [
    'AC-42',
    'a readable repository connector never hears the unreadable sentence',
    [
      'test_tracker_grounding.UnreadableConnectorTest.test_ac42_a_readable_connector_never_hears_the_sentence',
    ],
  ],
  [
    'AC-43',
    'a sign-in or rate limit failure is not an unreadable connector',
    [
      'test_tracker_grounding.UnreadableConnectorTest.test_ac43_sign_in_or_rate_limit_failures_are_not_unreadable',
    ],
  ],
  [
    'AC-45',
    'the Jira project never comes from a broad tracker search',
    [
      'test_tracker_grounding.StepZeroProjectScanTest.test_ac45_the_project_never_comes_from_a_broad_search',
    ],
  ],
  [
    'AC-48',
    'the directory build keeps every paqad skill and its manifest name',
    [
      'test_build.HostBranchTest.test_ac48_directory_branch_keeps_every_skill_of_the_paqad_target',
      'test_build.ListingManifestTest.test_ac48_directory_package_keeps_its_manifest_name',
    ],
  ],
];

describe('discovery plugin tests that prove the plugin, project scan and business docs criteria', () => {
  for (const [id, description, names] of CRITERIA) {
    it(`${id}: ${description}`, () => runPluginTests(names), TIMEOUT);
  }
});
