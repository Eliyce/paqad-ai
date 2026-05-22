#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
node - "$INPUT" <<'NODE'
    const trimmed = (process.argv[2] ?? "").trim();
  let files = [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed || '{}');
    files = Array.isArray(parsed) ? parsed : Array.isArray(parsed.files) ? parsed.files : [];
  } else {
    files = trimmed === '' ? [] : trimmed.split(/\r?\n/).filter(Boolean);
  }

  const targetMap = new Map();

  function isCanonicalDoc(target) {
    return (
      target === 'README.md' ||
      target.startsWith('docs/modules/') ||
      target.startsWith('docs/instructions/') ||
      target.startsWith('docs/maintainers/')
    );
  }

  function addTarget(target, owner, ownershipKind, reason) {
    if (!isCanonicalDoc(target)) {
      return;
    }

    const existing = targetMap.get(target) ?? {
      target_path: target,
      ownership_kind: ownershipKind,
      owners: [],
      reasons: [],
    };

    existing.ownership_kind =
      existing.ownership_kind === 'direct-doc-edit' || ownershipKind === 'direct-doc-edit'
        ? 'direct-doc-edit'
        : 'implementation-drift';

    if (owner) {
      existing.owners.push(owner);
    }
    if (reason) {
      existing.reasons.push(reason);
    }

    targetMap.set(target, existing);
  }

  for (const file of files) {
    if (
      file.startsWith('src/') ||
      file.startsWith('runtime/') ||
      file.startsWith('tests/') ||
      file === 'package.json' ||
      file.endsWith('.schema.json')
    ) {
      addTarget(
        'docs/modules/README.md',
        file,
        'implementation-drift',
        `Implementation change in ${file} can stale module-level canonical summaries.`,
      );
      addTarget(
        'docs/maintainers/architecture-map.md',
        file,
        'implementation-drift',
        `Implementation change in ${file} can stale architecture ownership mappings.`,
      );
    }

    if (file.startsWith('docs/modules/')) {
      addTarget(file, file, 'direct-doc-edit', `Canonical doc ${file} changed directly in the diff.`);
    }

    if (file.startsWith('docs/instructions/')) {
      addTarget(
        file,
        file,
        'direct-doc-edit',
        `Canonical doc ${file} changed directly in the diff.`,
      );
      addTarget(
        'docs/maintainers/architecture-map.md',
        file,
        'implementation-drift',
        `Instruction change in ${file} can stale the canonical ownership map.`,
      );
    }

    if (file.startsWith('docs/maintainers/')) {
      addTarget(file, file, 'direct-doc-edit', `Canonical doc ${file} changed directly in the diff.`);
    }
  }

  const stale = [...targetMap.values()]
    .map((entry) => ({
      target_path: entry.target_path,
      ownership_kind: entry.ownership_kind,
      owners: [...new Set(entry.owners)].sort(),
      reason: [...new Set(entry.reasons)].join(' '),
    }))
    .sort((a, b) => a.target_path.localeCompare(b.target_path));

  process.stdout.write(`${JSON.stringify(stale, null, 2)}\n`);
NODE
