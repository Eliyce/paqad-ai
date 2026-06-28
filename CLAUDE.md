# Claude Entry Framework

Before any repository work, open `.paqad/framework-path.txt`, resolve the reference inside it to the paqad install directory, and load and follow the framework bootstrap it points to (`AGENT-BOOTSTRAP.md` in that directory). That bootstrap decides — based on whether paqad is enabled — what to load and how to behave.

**Fallback:** if `.paqad/framework-path.txt` is missing or cannot be resolved, or paqad is disabled, proceed as a normal assistant with no paqad behavior. Do not block.

Adapter:
claude-code
