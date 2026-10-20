import ts from 'typescript';

const printer = ts.createPrinter({ removeComments: true });

const REF = String.raw`(?:(?<![\w&#])#\d{2,5}(?!\w)|\b(?:issues?|PR|pull)(?:\s+#?|\s*#)\d+(?![\w>]))`;
const HAS_REF = new RegExp(REF, 'i');
const GROUP = /\s*\(([^()]*)\)/g;
const BARE_REF = new RegExp(String.raw`\s*${REF}`, 'gi');

export function withoutIssueRefs(text: string): string {
  return text
    .replace(GROUP, (group: string, inner: string) => {
      const at = inner.search(HAS_REF);
      if (at < 0) return group;
      const kept = inner.slice(0, at).replace(/[\s,;/]+$/, '');
      if (kept === '') return '';
      return group.slice(0, group.indexOf('(')) + `(${kept})`;
    })
    .replace(BARE_REF, '');
}

function literals(stripRefs: boolean): ts.TransformerFactory<ts.SourceFile> {
  return (context) => {
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isStringLiteral(node)) {
        return ts.factory.createStringLiteral(stripRefs ? withoutIssueRefs(node.text) : node.text);
      }
      if (ts.isNoSubstitutionTemplateLiteral(node)) {
        const text = stripRefs ? withoutIssueRefs(node.text) : node.text;
        return ts.factory.createNoSubstitutionTemplateLiteral(text);
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (file) => ts.visitNode(file, visit) as ts.SourceFile;
  };
}

export function printedCode(source: string, options: { stripIssueRefs?: boolean } = {}): string[] {
  const file = ts.createSourceFile(
    'source.ts',
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const result = ts.transform(file, [literals(options.stripIssueRefs === true)]);
  const printed = printer.printFile(result.transformed[0]!);
  result.dispose();
  return printed.split('\n');
}
