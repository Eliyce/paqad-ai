#!/usr/bin/env python3
"""Unit tests for tests/evals/run_parity.py, the offline AC-20 structural-parity harness.

Standard library only (Python 3.9+). No network. Writes nothing outside a temporary folder.

Proves the gate has teeth (AC-11, AC-12):
  - run_parity.check_parity PASSES on the real built dist (every host branch structurally in parity);
  - it FAILS loudly on an injected divergence -- a host branch missing a skill, a divergent
    ticket-set schema between branches, and a malformed ticket-set -- never a silent empty pass.
"""

import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
EVALS_DIR = os.path.join(REPO_ROOT, "tests", "evals")
BUILD_DIR = os.path.join(REPO_ROOT, "build")
for entry in (EVALS_DIR, BUILD_DIR):
    if entry not in sys.path:
        sys.path.insert(0, entry)

import build  # noqa: E402
import run_parity  # noqa: E402

PLUGIN_NAME = "paqad-product-discovery"


class ParityHarnessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dist = os.path.join(self.tmp, "dist")
        build.build(REPO_ROOT, self.dist)

    def _check(self, **kwargs):
        return run_parity.check_parity(dist_root=self.dist, plugin_name=PLUGIN_NAME, **kwargs)

    def _branch_skills(self, host):
        return run_parity.branch_skills_root(self.dist, host, PLUGIN_NAME)

    def test_passes_on_the_real_dist(self):
        self.assertEqual(self._check(), [], "parity should hold on the real built dist")

    def test_fails_when_a_host_branch_is_missing_a_skill(self):
        # Remove paqad-ask from the chatgpt branch only: a journey divergence.
        shutil.rmtree(os.path.join(self._branch_skills("chatgpt"), "paqad-ask"))
        findings = self._check()
        self.assertTrue(findings, "a missing skill must produce a finding")
        self.assertTrue(
            any("chatgpt" in f for f in findings),
            "the finding must name the divergent host: {0}".format(findings),
        )

    def test_fails_when_a_branch_ticket_schema_diverges(self):
        # Corrupt the codex branch's shipped ticket-set schema so it differs from the others.
        schema = os.path.join(
            self._branch_skills("codex"),
            "paqad-write-tickets",
            "assets",
            "ticket-set.schema.json",
        )
        with open(schema, "a", encoding="utf-8") as handle:
            handle.write("\n{divergent}\n")
        findings = self._check()
        self.assertTrue(
            any("ticket_schema" in f for f in findings),
            "a divergent ticket-set schema must produce a finding: {0}".format(findings),
        )

    def test_fails_on_a_malformed_ticket_set(self):
        findings = self._check(ticket_set={"not": "a ticket set"})
        self.assertTrue(
            any("ticket set does not validate" in f for f in findings),
            "a malformed ticket set must produce a finding: {0}".format(findings),
        )

    def test_fails_when_a_whole_branch_is_missing(self):
        shutil.rmtree(os.path.join(self.dist, "hosts", "codex"))
        findings = self._check()
        self.assertTrue(
            any("codex" in f for f in findings),
            "a missing host branch must produce a finding: {0}".format(findings),
        )


if __name__ == "__main__":
    unittest.main()
