# paqad discovery

Use this plugin or the paqad plugin, not both. paqad already includes discover and ask.

paqad discovery helps you understand a product and plan work on it, without reading code. Ask what
the product does today, or turn an idea into clear user-story tickets. Answers come from the
repository you connect, its business documents first and then its code, in plain business words.

## What you need

- Claude with code execution turned on, or Codex.
- A repository added to the chat. The plugin works with any repository. It gives its best answers
  when the repository has project documents, and still answers from the code when it does not.
- Optional: the Jira connector, if you want the plugin to post tickets for you or to work from the
  epics and tickets you already have. Without it, you can download the tickets as a file and add
  them to any tracker yourself. With the Jira connector and no repository, the plugin can still
  shape an idea from your existing tickets, which show what was planned, not what is built.

## Install

In Claude Desktop:

1. Open Customize, then Plugins.
2. Select + Add, then Add marketplace.
3. Type `Eliyce/paqad-product-discovery-plugin` and select Sync.
4. Install paqad-product-discovery.

In Codex:

1. Run `codex plugin marketplace add Eliyce/paqad-product-discovery-plugin`.
2. Install paqad-product-discovery from the Plugins list.
3. To update later, run `codex plugin marketplace upgrade`.

## How to start

Start with `/paqad:start` and say what you want. It sends you to the right skill. You can also call
a skill directly:

| Command | What it does |
|---|---|
| `/paqad:start` | The front door. Tell it what you want and it picks the right skill for you. |
| `/paqad:ask` | Answers a question about what the product does today, with its sources. |
| `/paqad:discover` | Walks an idea from a rough thought to ready tickets, one step at a time. |

## Example prompts

- `/paqad:start what does the checkout do today?`
- `/paqad:ask how are returns handled today?`
- `/paqad:discover let shoppers save a basket for later`

## What it reads and writes

- It only reads. It never edits, runs or installs anything in your repository.
- It reads the project documents and the code by names, and opens only a few files per answer. It
  never reads secrets, environment files or dependency folders.
- When you shape an idea, it may also read existing epics and tickets in the one tracker project
  you point it at: no more than 25 search results and 10 opened tickets in a run. It never reads
  comments, attachments or people's names, and it never reads other projects.
- It writes nothing outside its own working folder. Tickets reach your tracker only through the
  tracker connector, and only after you approve them. You can put them under a new epic or under
  an epic that already exists; an existing epic is never changed.
- The publisher runs no server and collects nothing. Your AI host processes what the plugin reads,
  under the host's own terms, and your tracker receives search words taken from your idea and only
  the ticket text you approve.
- Every answer ends with one short source line, such as "paqad, from code only", so you know what
  the answer is based on.
- When an answer is limited because the repository is not fully set up, the plugin may show one
  short note, at most once per conversation, with a link to an information page:
  https://paqad.ai/?src=discovery-plugin. The `src=discovery-plugin` tag is the same for everyone.
  It carries no personal data, no repository data and nothing from your questions.

## Privacy

Read the full privacy policy at
https://github.com/Eliyce/paqad-product-discovery-plugin/blob/main/PRIVACY.md.

## Support

Report a problem or ask a question at https://github.com/Eliyce/paqad-product-discovery-plugin/issues,
or email haider@eliyce.com.

## License

MIT. See the LICENSE file.
