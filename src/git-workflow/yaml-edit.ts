import YAML, { isCollection, isMap, isScalar, type Node, type Pair, type YAMLMap } from 'yaml';

export type YamlPath = readonly string[];

function parse(text: string) {
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0].message);
  }
  return doc;
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

function lineEnd(text: string, offset: number): number {
  const at = text.indexOf('\n', Math.max(offset - 1, 0));
  return at === -1 ? text.length : at + 1;
}

function rangeOf(node: Node | null | undefined): [number, number] | null {
  const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
  return range ? [range[0], range[1]] : null;
}

function findPair(map: YAMLMap, key: string): Pair<Node, Node> | undefined {
  return (map.items as Array<Pair<Node, Node>>).find(
    (pair) => isScalar(pair.key) && String(pair.key.value) === key,
  );
}

function mapAt(text: string, path: YamlPath): YAMLMap | null {
  const doc = parse(text);
  const node = path.length === 0 ? doc.contents : doc.getIn(path, true);
  return isMap(node) ? node : null;
}

function renderPair(key: string, value: unknown, indent: string): string {
  const body = YAML.stringify({ [key]: value }, { lineWidth: 0, flowCollectionPadding: false });
  return body
    .split('\n')
    .filter((line, i, all) => !(i === all.length - 1 && line === ''))
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function flow(value: unknown): string {
  return YAML.stringify(value, {
    lineWidth: 0,
    collectionStyle: 'flow',
    flowCollectionPadding: false,
  }).trimEnd();
}

function scalarText(node: Node, value: unknown): string {
  if (isScalar(node) && typeof value === 'string') {
    if (node.type === 'QUOTE_DOUBLE') return JSON.stringify(value);
    if (node.type === 'QUOTE_SINGLE') return `'${value.replace(/'/g, "''")}'`;
  }
  return flow(value);
}

export function hasPath(text: string, path: YamlPath): boolean {
  return parse(text).hasIn(path);
}

export function readPath(text: string, path: YamlPath): unknown {
  const value = parse(text).getIn(path);
  return isCollection(value) ? (value as { toJSON(): unknown }).toJSON() : value;
}

export function insertKey(
  text: string,
  parentPath: YamlPath,
  key: string,
  value: unknown,
  comment: string | null = null,
): string {
  const parent = mapAt(text, parentPath);
  if (!parent || parent.flow) {
    throw new Error(`can't add ${[...parentPath, key].join('.')}: its parent isn't a block map`);
  }
  if (parentPath.length === 0) {
    const base = text.length === 0 || text.endsWith('\n') ? text : `${text}\n`;
    const lead = base.length === 0 ? '' : '\n';
    const commentLine = comment ? `# ${comment}\n` : '';
    return `${base}${lead}${commentLine}${renderPair(key, value, '')}\n`;
  }
  const first = parent.items[0] as Pair<Node, Node> | undefined;
  const firstKey = rangeOf(first?.key);
  const parentRange = rangeOf(parent);
  if (!firstKey || !parentRange) {
    throw new Error(`can't add ${[...parentPath, key].join('.')}: its parent is empty`);
  }
  const indent = ' '.repeat(firstKey[0] - lineStart(text, firstKey[0]));
  const last = parent.items[parent.items.length - 1] as Pair<Node, Node>;
  const lastEnd = rangeOf(last.value)?.[1] ?? rangeOf(last.key)?.[1] ?? parentRange[1];
  const at = lineEnd(text, lastEnd);
  const head = at > 0 && text[at - 1] !== '\n' ? `${text.slice(0, at)}\n` : text.slice(0, at);
  const commentLine = comment ? `${indent}# ${comment}\n` : '';
  return `${head}${commentLine}${renderPair(key, value, indent)}\n${text.slice(at)}`;
}

export function setValue(text: string, path: YamlPath, value: unknown): string {
  const doc = parse(text);
  const node = doc.getIn(path, true) as Node | undefined;
  const range = rangeOf(node);
  if (!node || !range) {
    const parentPath = path.slice(0, -1);
    return insertKey(text, parentPath, path[path.length - 1], value);
  }
  if (JSON.stringify(readPath(text, path)) === JSON.stringify(value)) return text;
  const isBlock = isCollection(node) && !(node as { flow?: boolean }).flow;
  const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
  if (isBlock && isObject && Object.keys(value as object).length > 0) {
    const start = lineStart(text, range[0]);
    const end = lineEnd(text, range[1]);
    const indent = ' '.repeat(range[0] - start);
    const body = YAML.stringify(value, { lineWidth: 0, flowCollectionPadding: false })
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => `${indent}${line}`)
      .join('\n');
    return `${text.slice(0, start)}${body}\n${text.slice(end)}`;
  }
  if (isCollection(node) && !isBlock && isObject && Object.keys(value as object).length > 0) {
    const start = lineStart(text, range[0]);
    const keyIndent = /^[ \t]*/.exec(text.slice(start))?.[0] ?? '';
    const body = YAML.stringify(value, { lineWidth: 0, flowCollectionPadding: false })
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => `${keyIndent}  ${line}`)
      .join('\n');
    const before = text.slice(0, range[0]).replace(/[ \t]+$/, '');
    return `${before}\n${body}${text.slice(range[1])}`;
  }
  if (isBlock) {
    const start = range[0];
    const end = lineEnd(text, range[1]);
    const before = text.slice(0, start).replace(/\n[ \t]*$/, ' ');
    return `${before}${flow(value)}\n${text.slice(end)}`;
  }
  return `${text.slice(0, range[0])}${scalarText(node, value)}${text.slice(range[1])}`;
}

export function removeKey(text: string, path: YamlPath): string {
  const parent = mapAt(text, path.slice(0, -1));
  const pair = parent ? findPair(parent, path[path.length - 1]) : undefined;
  const keyRange = rangeOf(pair?.key);
  if (!pair || !keyRange) return text;
  const valueEnd = rangeOf(pair.value)?.[1] ?? keyRange[1];
  return `${text.slice(0, lineStart(text, keyRange[0]))}${text.slice(lineEnd(text, valueEnd))}`;
}
