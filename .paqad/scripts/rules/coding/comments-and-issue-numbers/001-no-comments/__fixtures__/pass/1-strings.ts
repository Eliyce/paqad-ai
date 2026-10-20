const a = '// not a comment';
const b = "/* not a comment */";
const c = `// still text ${'/* inner string */'} and /* more text */`;
const d = /\/\/ not a comment/;
const e = /\/\*/g;
const f = 'https://example.com/path';
const g = a.length / 2 / b.length;
export { a, b, c, d, e, f, g };
