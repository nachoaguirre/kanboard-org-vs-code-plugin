# Kanboard for VS Code

[Kanboard](https://kanboard.org) integration for VS Code: browse your projects, tasks and activity without leaving the editor.

## Features

Adds a Kanboard icon to the Activity Bar with four views:

- **My Dashboard** — your projects (via `getMyProjects`), expandable to show your open tasks in each one.
- **My Tasks** — all open tasks assigned to you, with project and column. Filterable by project and column.
- **Overdue Tasks** — tasks past their due date (via `getMyOverdueTasks`).
- **My Activity** — your recent activity stream (via `getMyActivityStream`).

Plus:

- **Task detail panel**: click any task to see its metadata, description, subtasks and comments rendered as markdown.
- **Task actions**: move a task to another column or close it, from the right-click menu or the detail panel.
- **Quick task creation** from VS Code (`Kanboard: Create Task`).
- **Status bar counter** with your open tasks, highlighted when something is overdue. Click it to jump to My Tasks. Auto-refreshes every 5 minutes.
- Open any task or board in the browser (🌐 icon).
- Refresh button on every view.

## Setup

1. In Kanboard, copy your personal API token from **Settings → API**.
2. In VS Code run **Kanboard: Connect to Kanboard** (or use the welcome button in the view).
3. Enter your instance URL, username and token.

URL and username are stored in user settings (`kanboard.url`, `kanboard.username`). The token is stored in VS Code secret storage, never in plain text.

To disconnect and delete the token: **Kanboard: Disconnect**.

## Troubleshooting

Run **Kanboard: Diagnostics (dump raw API responses)** to see exactly what your instance returns for each API method.

## Development

```bash
npm install
npm run compile   # type-check + lint + bundle
```

Press `F5` in VS Code to launch the Extension Development Host.
