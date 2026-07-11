# Change Log

All notable changes to the "Kanboard" extension will be documented in this file.

## [0.0.2]

- Removed the Diagnostics command: its raw `getMe` dump included the user's API token in plaintext, which could easily be leaked when sharing the output in bug reports.

## [0.0.1]

Initial release.

- Activity Bar container with four views: My Dashboard, My Tasks, Overdue Tasks and My Activity.
- Connect flow with URL, username and API token (token stored in VS Code secret storage).
- Task detail panel with metadata, markdown description, subtasks and comments.
- Task actions: move to column, close task, open in browser.
- Quick task creation from VS Code.
- My Tasks filter by project and column.
- My Activity toggle between own activity and team activity.
- Status bar counter with open and overdue tasks, auto-refreshing every 5 minutes.
- Diagnostics command to dump raw API responses.
