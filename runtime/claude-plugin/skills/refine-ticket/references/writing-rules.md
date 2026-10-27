# Writing rules

Every epic and ticket follows these rules. The prose check in check-tickets enforces them where it
can run; this file is the rule the check is built from, so the drafting follows it from the start.

## The rules

- **No dashes used as dashes.** No em dash (U+2014) and no en dash (U+2013) anywhere in ticket
  text. Use an ASCII hyphen, or rewrite the sentence.
- **No code words in the title, goal, the user story or the acceptance criteria.** The user story
  is the As a, I want and So that lines ("what they need" on an older ticket); the acceptance
  criteria are the "done when" items. No file paths, function or class names, camelCase or
  snake_case identifiers, backtick code, web request verbs, database terms, or library names. The
  plain names of modules from the project registry are allowed.
- **One allowed code span.** A permission key confirmed with the user, written in inline code as
  can verb noun (for example `can view savings`), is the one code span allowed in acceptance
  criteria; the prose check accepts it.
- **No jargon from the deny-list.** The shared `plain-language.md` lists each jargon term and its
  plain replacement. Use the plain word. The match is on whole words and ignores case.
- **Short sentences.** Keep sentences short. A sentence above about 30 words is a warning to
  tighten it, not a hard failure.
- **Nothing invented.** No made-up numbers, dates, names or commitments. Where a success measure
  has no number, write "To be measured after release" rather than inventing one.

## What the checker skips

The prose checker skips quoted text (blockquotes and inline code spans), fenced code blocks and
URLs, exactly as the ported 0.2.0 checker does. This means quoted evidence from a document, a
code name shown as a quote, or a link on the Sources line is never rewritten. Keep genuine code
names and paths inside quotes or on the Sources line so they are read as evidence, not prose.

## Where the rules apply hardest

The title, goal, the user story (As a, I want, So that, or "what they need and why" on an older
ticket) and the acceptance criteria ("done when") carry the heaviest plain-words duty, because a
developer and a tester read them directly. The "what exists today" and "sources" sections may carry
a quoted path or term as evidence, kept inside quotes or on the Sources line.
