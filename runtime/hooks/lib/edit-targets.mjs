export function parseApplyPatchPaths(text) {
  const paths = [];
  if (typeof text !== 'string') {
    return paths;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\*\*\*\s+(?:Add File|Update File|Delete File|Move to):\s+(.+?)\s*$/.exec(line);
    if (match && match[1]) {
      paths.push(match[1]);
    }
  }
  return paths;
}

export function editTargets(payload) {
  const toolInput = payload?.tool_input;
  if (toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput)) {
    const single = toolInput.file_path ?? toolInput.notebook_path;
    if (typeof single === 'string' && single.trim() !== '') {
      return [single];
    }
    const collected = [];
    for (const value of Object.values(toolInput)) {
      if (typeof value === 'string') {
        collected.push(...parseApplyPatchPaths(value));
      }
    }
    return collected;
  }
  if (typeof toolInput === 'string') {
    return parseApplyPatchPaths(toolInput);
  }
  return [];
}
