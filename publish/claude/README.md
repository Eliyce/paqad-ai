# Paqad Product Discovery

Paqad Product Discovery helps you understand a product and plan work on it, without reading code.
Ask what the product does today, turn an idea into clear tickets, improve a ticket you already have,
get a size estimate for a piece of work, or plan the next sprint. Answers come from the repository
you connect, in plain business words.

## What you need

- Claude with code execution turned on.
- A repository added to the chat. The plugin works with any repository. It gives its best answers
  when the repository has project documents, and still answers from the code when it does not.
- Optional: the Jira connector, if you want the plugin to post tickets for you. Without it, you can
  download the tickets as a file and add them to any tracker yourself.

## Install

- From the Claude plugin directory: find Paqad Product Discovery and select Install.
- In Claude Code: run `/plugin marketplace add Eliyce/paqad-product-discovery-plugin`, then
  `/plugin install paqad-product-discovery@paqad-product-discovery`.

## How to start

Start with `/paqad` and say what you want. It sends you to the right skill. You can also call a skill
directly:

| Skill | What it does |
|---|---|
| `/paqad` | The front door. Tell it what you want and it picks the right skill for you. |
| `paqad-ask` | Answers a question about what the product does today, with its sources. |
| `paqad-discover` | Walks an idea from a rough thought to ready tickets, one step at a time. |
| `paqad-refine-ticket` | Improves an existing ticket and changes it only when you approve. |
| `paqad-size-work` | Suggests a size for a piece of work, based on similar past work. |
| `paqad-plan-sprint` | Proposes a sprint plan and assigns the work when you approve. |

## Example prompts

- `/paqad what does the checkout do today?`
- `Turn this idea into tickets: let shoppers save a basket for later`
- `Refine PROJ-123`
- `Size this work: add a gift message at checkout`
- `Plan the next sprint`

## What it reads and writes

- It only reads. It never edits, runs or installs anything in your repository.
- It reads the project documents and the code by names, and opens only a few files per answer. It
  never reads secrets, environment files or dependency folders.
- It writes nothing outside its own working folder. Tickets reach your tracker only through the
  tracker connector, and only after you approve them.
- The publisher runs no server and collects nothing. Your AI host processes what the plugin reads,
  under the host's own terms, and your tracker receives only the ticket text you approve.
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
