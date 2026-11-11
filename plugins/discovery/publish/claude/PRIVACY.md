# Privacy policy

This is the privacy policy for the paqad Product Discovery plugin. It is written in plain words so a
business user and a directory reviewer can both see exactly what the plugin does with data. It
describes what the plugin actually does, nothing more.

## What the plugin is

The plugin helps a business user ask what a product does, shape an idea into tickets, refine a
ticket, size work and plan a sprint. It runs inside an AI chat host you already use. It only reads;
it never edits, runs or installs anything in your repository.

## What the plugin reads

To answer, the plugin reads the files in the repository you point it at:

- The project documents under `docs/` when they are present, for business language, roles and rules.
- The source code by names (folder, route, page, action, model and test names), as the baseline for
  what exists, labelled as what the code suggests. It opens a small number of files per answer.

When you shape an idea into tickets, the plugin may also read existing epics and tickets in the one
tracker project you point it at, through the host's tracker connector and under your own access:

- It looks at no more than 25 search results and opens no more than 10 tickets in a run.
- It uses only the key, type, summary, description, status, parent, labels and last updated date.
- It never reads comments, attachments, work logs or people's names (assignee, reporter), and it
  never reads other projects.
- Before posting under an epic you chose, it reads that one epic again to check it. It never
  changes an existing epic.

Only the idea journey does this. Asking a question, refining a ticket, sizing work and planning a
sprint read the tracker only as they did before.

It reads one repository per run, and it reads a file only to answer your question. The plugin and
its publisher (Eliyce) run no server of their own and collect, store or receive none of your data.

## What the plugin never reads

The plugin keeps a never-read list and honours it in every mode:

- Secrets and environment files.
- The `.paqad/` runtime folder. When a `.paqad/` directory is used as a signal that a repository is
  set up, its presence is tested only; its contents are never opened.
- `docs/instructions/rules/`, `.git/`, and dependency or vendored folders such as `vendor/` and
  `node_modules/`.

## What the plugin writes

The plugin writes nothing outside its own working folder. Within a run it keeps a discovery record
(your choices, the areas found, the draft tickets and sizes) in the working folder so the
conversation can carry on. It does not write into your source code. Posting tickets to a tracker
goes through the host's tracker connector, and only when you approve the post; the plugin handles
no tracker credentials itself.

## Who sees your data

The plugin itself sends nothing to its publisher or to any server of its own. Data reaches others
only through the tools you already use:

- **Your AI host.** The plugin runs inside an AI chat host, such as Claude. The host processes your
  conversation and what the plugin reads from your repository, under the host's own terms and
  privacy policy.
- **Your tracker.** When you approve a post, the ticket text you approved goes to your tracker (for
  example Jira) through the host's tracker connector, under that tracker's own terms. Nothing is
  created or changed in the tracker without your approval. When the plugin reads existing epics and
  tickets, search words taken from your idea are sent to the tracker. The ticket text it reads is
  processed by your AI host and kept as short lines, in the plugin's own words, in the discovery
  record in the working folder.
- **The information link.** If you open the nudge link described below, your browser visits
  paqad.ai and sends only the static `src=discovery-plugin` tag in the address.

The publisher sees none of this. It receives no conversation, no repository content, no ticket and
no usage data.

## The upgrade nudge link

When a repository is not fully set up with paqad, the plugin may show one informational nudge, at
most once per conversation or when you ask why an answer is thin. The nudge links to an information
page only, never to a purchase page.

The nudge link is exactly `https://paqad.ai/?src=discovery-plugin`. It carries only the static
campaign tag `src=discovery-plugin`. It carries no user data, no repository name or contents, and
no part of your question. The tag is the same for everyone and identifies only that the visit came
from this plugin. It is also disclosed in the project README.

## In short

The plugin reads your repository to answer and, when you shape an idea, may read a limited number
of existing epics and tickets in the one tracker project you point it at, never their comments,
attachments or people's names. It keeps a never-read list it always honours, writes
nothing outside its working folder, handles no tracker credentials of its own, and the one upgrade
link carries only a static campaign tag with no user, repository or question data. Your AI host
processes what the plugin reads, your tracker receives search words and only the tickets you
approve, and the publisher collects nothing.

## Contact

Questions about this policy or the plugin: open an issue at
https://github.com/Eliyce/paqad-product-discovery-plugin/issues or email haider@eliyce.com.

## Changes

Any change to this policy is published in this file, in the same repository as the plugin.
