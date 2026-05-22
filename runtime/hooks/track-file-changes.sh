#!/usr/bin/env bash
set -euo pipefail

INPUT=$(cat)
node -e "
const fs=require('fs');const path=require('path');
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  const j=JSON.parse(d||'{}');
  const out=j.output_path;
  if(!out){console.error(JSON.stringify({message:'track-file-changes: missing output_path'}));process.exit(2);}
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(j.files||[],null,2));
});
" <<<"$INPUT"
exit 0
