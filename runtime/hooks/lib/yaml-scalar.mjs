function indentOf(line) {
  const match = /^[ \t]*/.exec(line);
  return match ? match[0].length : 0;
}

function isContent(line) {
  const trimmed = line.trim();
  return trimmed !== '' && !trimmed.startsWith('#');
}

function keyValue(line, key) {
  const body = line.replace(/^[ \t]+/, '');
  if (!body.startsWith(`${key}:`)) return null;
  const rest = body.slice(key.length + 1);
  if (rest !== '' && !/^[ \t]/.test(rest)) return null;
  return rest;
}

export function cleanScalar(rest) {
  let value = ` ${rest}`;
  const hash = value.search(/[ \t]#/);
  if (hash !== -1) value = value.slice(0, hash);
  value = value.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return value === '' ? undefined : value;
}

export function readYamlScalar(text, path) {
  if (typeof text !== 'string' || !Array.isArray(path) || path.length < 1 || path.length > 2) {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  const [top, child] = path;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!isContent(line) || indentOf(line) !== 0) continue;
    const rest = keyValue(line, top);
    if (rest === null) continue;
    if (child === undefined) return cleanScalar(rest);
    let childIndent = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      const inner = lines[j];
      if (!isContent(inner)) continue;
      const indent = indentOf(inner);
      if (indent === 0) return undefined;
      if (childIndent === -1) childIndent = indent;
      if (indent !== childIndent) continue;
      const value = keyValue(inner, child);
      if (value !== null) return cleanScalar(value);
    }
    return undefined;
  }
  return undefined;
}
