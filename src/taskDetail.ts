import * as vscode from 'vscode';
import {
	KanboardClient,
	KanboardColumn,
	KanboardComment,
	KanboardSubtask,
	KanboardTask
} from './kanboardClient';
import { closeTaskInteractive, moveTaskInteractive } from './taskActions';

function escapeHtml(value: unknown): string {
	return String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
	);
}

// marked v5+ is ESM-only while this bundle is CommonJS, so it is loaded
// lazily via dynamic import and cached for synchronous use during rendering.
let markedParse: ((markdown: string) => string) | undefined;

async function ensureMarked(): Promise<void> {
	if (!markedParse) {
		const { marked } = await import('marked');
		markedParse = (markdown) => marked.parse(markdown, { async: false });
	}
}

function renderMarkdown(value: unknown): string {
	if (!value) {
		return '<p class="muted">—</p>';
	}
	const text = String(value);
	return markedParse ? markedParse(text) : `<pre>${escapeHtml(text)}</pre>`;
}

function formatDateTime(timestamp: number | string | undefined): string | undefined {
	const value = Number(timestamp);
	if (!value) {
		return undefined;
	}
	return new Date(value * 1000).toLocaleString();
}

/**
 * Singleton webview panel showing the details of one task at a time,
 * with actions (open in browser, move column, close).
 */
export class TaskDetailPanel {
	private static current: TaskDetailPanel | undefined;

	static async show(
		client: KanboardClient,
		taskId: number | string,
		projectId: number | string,
		onTaskChanged: () => void
	): Promise<void> {
		if (!TaskDetailPanel.current) {
			TaskDetailPanel.current = new TaskDetailPanel();
		}
		const panel = TaskDetailPanel.current;
		panel.client = client;
		panel.onTaskChanged = onTaskChanged;
		panel.panel.reveal(undefined, false);
		await panel.load(taskId, projectId);
	}

	private readonly panel: vscode.WebviewPanel;
	private client!: KanboardClient;
	private onTaskChanged: () => void = () => undefined;
	private taskId: number | string = 0;
	private projectId: number | string = 0;

	private constructor() {
		this.panel = vscode.window.createWebviewPanel('kanboardTask', 'Kanboard Task', vscode.ViewColumn.Active, {
			enableScripts: true
		});
		this.panel.onDidDispose(() => {
			TaskDetailPanel.current = undefined;
		});
		this.panel.webview.onDidReceiveMessage(async (message: { command?: string }) => {
			try {
				switch (message?.command) {
					case 'openInBrowser':
						vscode.env.openExternal(vscode.Uri.parse(this.client.taskUrl(this.taskId, this.projectId)));
						break;
					case 'move':
						if (await moveTaskInteractive(this.client, this.taskId, this.projectId)) {
							this.onTaskChanged();
							await this.load(this.taskId, this.projectId);
						}
						break;
					case 'close':
						if (await closeTaskInteractive(this.client, this.taskId)) {
							this.onTaskChanged();
							this.panel.dispose();
						}
						break;
					case 'refresh':
						await this.load(this.taskId, this.projectId);
						break;
				}
			} catch (err) {
				vscode.window.showErrorMessage(`Kanboard: ${err instanceof Error ? err.message : String(err)}`);
			}
		});
	}

	private async load(taskId: number | string, projectId: number | string): Promise<void> {
		this.taskId = taskId;
		this.projectId = projectId;
		this.panel.title = `Task #${taskId}`;
		this.panel.webview.html = this.wrap('<p class="muted">Loading task…</p>', false);
		try {
			await ensureMarked();
			const [task, columns, comments, subtasks, tags, project] = await Promise.all([
				this.client.getTask(taskId),
				this.client.getColumns(projectId).catch(() => [] as KanboardColumn[]),
				this.client.getAllComments(taskId).catch(() => [] as KanboardComment[]),
				this.client.getAllSubtasks(taskId).catch(() => [] as KanboardSubtask[]),
				this.client.getTaskTags(taskId).catch(() => ({}) as Record<string, string>),
				this.client.getProjectById(projectId).catch(() => undefined)
			]);
			this.panel.title = `#${task.id} · ${task.title}`;
			this.panel.webview.html = this.wrap(
				this.renderTask(task, columns || [], comments || [], subtasks || [], tags || {}, project?.name)
			);
		} catch (err) {
			this.panel.webview.html = this.wrap(
				`<p>Could not load task #${escapeHtml(taskId)}: ${escapeHtml(
					err instanceof Error ? err.message : String(err)
				)}</p>`,
				false
			);
		}
	}

	private renderTask(
		task: KanboardTask,
		columns: KanboardColumn[],
		comments: KanboardComment[],
		subtasks: KanboardSubtask[],
		tags: Record<string, string>,
		projectName?: string
	): string {
		const column = columns.find((c) => String(c.id) === String(task.column_id));
		const due = formatDateTime(task.date_due);
		const overdue = Number(task.date_due) > 0 && Number(task.date_due) * 1000 < Date.now();

		const meta: [string, string][] = [];
		if (projectName) {
			meta.push(['Project', escapeHtml(projectName)]);
		}
		if (column) {
			meta.push(['Column', escapeHtml(column.title)]);
		}
		if (task.assignee_username || task.assignee_name) {
			meta.push(['Assignee', escapeHtml(task.assignee_name || task.assignee_username)]);
		}
		if (Number(task.priority) > 0) {
			meta.push(['Priority', `P${Number(task.priority)}`]);
		}
		if (due) {
			meta.push(['Due date', overdue ? `<span class="overdue">${escapeHtml(due)} (overdue)</span>` : escapeHtml(due)]);
		}
		const created = formatDateTime(task.date_creation);
		if (created) {
			meta.push(['Created', escapeHtml(created)]);
		}
		const modified = formatDateTime(task.date_modification);
		if (modified) {
			meta.push(['Modified', escapeHtml(modified)]);
		}
		const tagNames = Object.values(tags);
		if (tagNames.length > 0) {
			meta.push(['Tags', tagNames.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')]);
		}

		const subtaskIcon = (status: number) => (status === 2 ? '✅' : status === 1 ? '🔄' : '⬜');
		const subtasksHtml =
			subtasks.length === 0
				? ''
				: `<h2>Subtasks</h2><ul class="subtasks">${subtasks
						.map(
							(s) =>
								`<li>${subtaskIcon(Number(s.status))} ${escapeHtml(s.title)}${
									s.name || s.username ? ` <span class="muted">· ${escapeHtml(s.name || s.username)}</span>` : ''
								}</li>`
						)
						.join('')}</ul>`;

		const commentsHtml =
			comments.length === 0
				? ''
				: `<h2>Comments (${comments.length})</h2>${comments
						.map(
							(c) =>
								`<div class="comment"><div class="comment-header">${escapeHtml(
									c.name || c.username || 'unknown'
								)} <span class="muted">${escapeHtml(formatDateTime(c.date_creation) || '')}</span></div>${renderMarkdown(
									c.comment
								)}</div>`
						)
						.join('')}`;

		const color = typeof task.color_id === 'string' && /^[a-z_]+$/.test(task.color_id) ? task.color_id : 'grey';

		return `
			<div class="header" style="border-left: 4px solid ${color}; padding-left: 12px;">
				<h1>${escapeHtml(task.title)} <span class="muted">#${escapeHtml(task.id)}</span></h1>
				<div class="actions">
					<button data-command="openInBrowser">$open Open in Browser</button>
					<button data-command="move">Move to Column…</button>
					<button data-command="close" class="danger">Close Task</button>
					<button data-command="refresh">Refresh</button>
				</div>
			</div>
			<dl class="meta">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
			<h2>Description</h2>
			<div class="description">${renderMarkdown(task.description)}</div>
			${subtasksHtml}
			${commentsHtml}
		`.replace('$open', '🌐');
	}

	private wrap(body: string, withScript = true): string {
		const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
		const script = withScript
			? `<script nonce="${nonce}">
				const vscode = acquireVsCodeApi();
				document.querySelectorAll('button[data-command]').forEach((button) => {
					button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command }));
				});
			</script>`
			: '';
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 20px 40px; max-width: 900px; line-height: 1.5; }
	h1 { font-size: 1.4em; margin-bottom: 4px; }
	h2 { font-size: 1.1em; margin-top: 24px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
	.muted { color: var(--vscode-descriptionForeground); font-weight: normal; }
	.overdue { color: var(--vscode-errorForeground); font-weight: bold; }
	.header { margin-top: 16px; }
	.actions { margin: 8px 0 16px; display: flex; gap: 8px; flex-wrap: wrap; }
	button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 5px 12px; border-radius: 3px; cursor: pointer; font-family: inherit; }
	button:hover { background: var(--vscode-button-hoverBackground); }
	button.danger { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
	.meta { display: grid; grid-template-columns: max-content 1fr; gap: 4px 20px; margin: 12px 0; }
	.meta dt { color: var(--vscode-descriptionForeground); }
	.meta dd { margin: 0; }
	.tag { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 8px; padding: 1px 8px; font-size: 0.85em; }
	.description, .comment { background: var(--vscode-textBlockQuote-background); border-radius: 4px; padding: 8px 12px; }
	.comment { margin: 10px 0; border-left: 2px solid var(--vscode-panel-border); }
	.comment-header { font-weight: bold; margin-bottom: 4px; }
	.subtasks { list-style: none; padding-left: 4px; }
	.subtasks li { margin: 4px 0; }
	code, pre { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); border-radius: 3px; }
	pre { padding: 8px; overflow-x: auto; }
	a { color: var(--vscode-textLink-foreground); }
	img { max-width: 100%; }
</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
	}
}
