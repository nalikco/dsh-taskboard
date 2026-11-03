# dsh-taskboard

Agile task board for [DeepSeek Harness](https://github.com/deepseek-ai): To Do / In Progress / Done columns opened from the sidebar.

## Features

- Board with drag and drop, edit and delete; the UI follows DSH theme tokens.
- Every task can be linked to a workspace and to an existing (non-archived) session.
- **Improve with AI**: rewrites a rough note into a clear title with the default model, using the selected workspace (project summary) and the linked session (title and user messages) as context.
- Agent tool `taskboard` (`list`, `add`, `update`, `move`, `remove`): the agent and the board share one store.
- Locales: `en`, `ru` (`ru` is picked up automatically once DSH ships it).

## Install

```
git clone https://github.com/nalikco/dsh-taskboard
```

Then install the checkout as a bundle from DSH (Plugin Manager, local directory), or ask the agent to run `plugin_manager install_bundle` with the absolute path.

Requires DSH `^0.2.0-rc.2`.

## Data

Tasks are stored on the Host in `$DSH_HOME/state/taskboard/tasks.json` (default `~/.dsh/state/taskboard/tasks.json`).
Tasks kept in the browser's `localStorage` by earlier versions are imported once; `localStorage` itself is left untouched.

## Privacy

Improve with AI sends to the default model: your note, the project name, top-level file names, the `package.json` description and the first 2000 characters of `AGENTS.md`, `CLAUDE.md` or `README.md`, and, for a linked session, its title and up to four of your messages. Replies and tool output are never sent.
