#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
node -e "
const fs=require('fs');const path=require('path');
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const input=JSON.parse(d||'{}');
  const out=input.output_path;
  if(!out){console.error(JSON.stringify({message:'context-hit-tracker: missing output_path'}));process.exit(2);}
  const loaded=input.files_loaded||0;
  const referenced=input.files_referenced||0;
  const rate=loaded===0?0:referenced/loaded;
  const entry={
    session_id:input.session_id||'session',
    phase:input.phase||'phase',
    files_loaded:loaded,
    files_referenced:referenced,
    hit_rate:Math.round(rate*1e4)/1e4,
    unreferenced_files:input.unreferenced_files||[],
    timestamp:new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(entry,null,2));
});
" <<<"$INPUT"
exit 0
