export interface ClassificationRule {
  pattern: RegExp;
  subcategory: string;
}

export const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    pattern: /threshold|magic.?number|hard.?coded.?value|numeric.?literal/i,
    subcategory: 'D3.threshold-heuristic',
  },
  {
    pattern: /type.?coer|instanceof|typeof.*check|type.?guard/i,
    subcategory: 'D3.type-coercion-heuristic',
  },

  {
    pattern: /\b(?:cli|command.?line)\b.*(flag|command|option|subcommand|expose|surface)/i,
    subcategory: 'D5.missing-cli-surface',
  },
  {
    pattern: /(command|flag|option|subcommand).*(?:cli|command.?line)/i,
    subcategory: 'D5.missing-cli-surface',
  },
  {
    pattern: /\bsubcommand\b.*\b(surface|surfaced|expose|exposed|missing)\b/i,
    subcategory: 'D5.missing-cli-surface',
  },
  {
    pattern: /boundary|exactly\s+\d|at\s+the\s+limit|off.?by.?one|fence.?post/i,
    subcategory: 'D5.missing-boundary',
  },
  {
    pattern: /error.*(handling|path|case|state)|failure.*(case|path|mode)|exception/i,
    subcategory: 'D5.missing-error-handling',
  },
  {
    pattern: /empty.*(case|input|collection|list|array)|no\s+items|zero\s+items/i,
    subcategory: 'D5.missing-empty-case',
  },
  { pattern: /self.?clos|xml|html.*tag|closing.*tag/i, subcategory: 'D5.missing-format-variant' },
  {
    pattern: /format.?(variant|version|flavou?r|dialect)|alternative.?format/i,
    subcategory: 'D5.missing-format-variant',
  },
  {
    pattern: /enum|state\s+machine|all\s+(possible\s+)?states|\bvariant\b/i,
    subcategory: 'D5.missing-enum-variant',
  },
  {
    pattern: /file.*(path|location|directory)|wrong.?path|incorrect.?path/i,
    subcategory: 'D5.wrong-file-path',
  },
  {
    pattern: /negative.*(case|path|test)|when\s+not|otherwise/i,
    subcategory: 'D5.missing-negative-case',
  },

  {
    pattern: /tautolog|trivial.*test|test.*trivial|assert.*itself/i,
    subcategory: 'D8.tautological-test',
  },
  {
    pattern: /mock.?only|stub.?only|no.?real.*assert|hollow.*test/i,
    subcategory: 'D8.mock-only-test',
  },

  {
    pattern: /not\s+in\s+(the\s+)?spec|invented|unspecified\s+logic|undocumented\s+behavior/i,
    subcategory: 'D1.unspecified-logic',
  },

  {
    pattern: /wrong\s+obligation|mismatched\s+id|incorrect\s+obligation/i,
    subcategory: 'D2.wrong-obligation-mapping',
  },
];

export function classifyDefect(description: string, sourceCategory: string): string {
  const normalized = description.toLowerCase();
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(normalized)) {
      return rule.subcategory;
    }
  }
  return `${sourceCategory}.unclassified`;
}
