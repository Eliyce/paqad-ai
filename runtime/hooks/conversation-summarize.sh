#!/usr/bin/env bash
# conversation-summarize hook
# Triggered at configurable turn intervals to summarize old conversation turns.
# Reads a JSON payload from stdin with turn_count and auto_summarize_interval fields.
set -euo pipefail

INPUT="$(cat)"
node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  let parsed;
  try { parsed=JSON.parse(d||'{}'); } catch { parsed={}; }

  const turnCount=Number(parsed.turn_count??0);
  const interval=Number(parsed.auto_summarize_interval??20);
  const shouldSummarize=interval>0&&turnCount>0&&turnCount%interval===0;

  process.stdout.write(JSON.stringify({
    action: shouldSummarize?'summarize':'continue',
    turn_count: turnCount,
    interval: interval,
  },null,2)+'\n');
  process.exit(0);
});
" <<<"$INPUT"
