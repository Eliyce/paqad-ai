#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"
node - "$INPUT" <<'NODE'
    const parsed = JSON.parse(process.argv[2] || "{}");
  const currentHitRate = Number(parsed.current_hit_rate ?? 0);
  const targetHitRate = Number(parsed.target_hit_rate ?? 0.7);
  const tokensUsed = Number(parsed.tokens_used ?? 0);
  const maxTokens = Number(parsed.max_tokens ?? 1);
  const utilization = maxTokens <= 0 ? 0 : tokensUsed / maxTokens;
  const shouldCompact = currentHitRate < targetHitRate || utilization >= 0.85;
  const result = {
    action: shouldCompact ? 'compact-and-resume' : 'continue',
    should_resume: shouldCompact,
    current_hit_rate: currentHitRate,
    target_hit_rate: targetHitRate,
    token_utilization: Math.round(utilization * 1e4) / 1e4,
    reason:
      currentHitRate < targetHitRate
        ? 'context-hit-rate-below-target'
        : utilization >= 0.85
          ? 'token-budget-tight'
          : 'healthy',
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(shouldCompact ? 10 : 0);
NODE
