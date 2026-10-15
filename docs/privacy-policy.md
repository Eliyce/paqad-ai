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

It reads one repository per run. It reads a file only to answer your question; it does not send your
files, your repository or your questions anywhere.

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
conversation can carry on. It does not write into your source code. When you ask it to post tickets
to a tracker, that write goes through the host's own tracker connection; the plugin handles no
tracker credentials itself.

## The upgrade nudge link

When a repository is not fully set up with paqad, the plugin may show one informational nudge, at
most once per conversation or when you ask why an answer is thin. The nudge links to an information
page only, never to a purchase page.

The nudge link carries only a static campaign tag (for example `src=discovery-plugin`). It carries
no user data, no repository name or contents, and no part of your question. The tag is the same for
everyone and identifies only that the visit came from this plugin. It is also disclosed in the
project README.

## In short

The plugin reads your repository to answer, keeps a never-read list it always honours, writes
nothing outside its working folder, handles no tracker credentials of its own, and the one upgrade
link carries only a static campaign tag with no user, repository or question data.
