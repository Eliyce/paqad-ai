#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
const j=JSON.parse(d||'{}');const fs=require('fs');const lane=j.lane||'fast'; if(lane==='fast'){process.exit(0)}
const path=j.spec_path||''; if(path && fs.existsSync(path)){process.exit(0)}
console.error(JSON.stringify({message:'No spec found for story '+(j.story_id||'unknown')})); process.exit(2);});
" <<<"$INPUT"
