import * as vscode from 'vscode';
import { KanboardClient, KanboardEvent, KanboardProject, KanboardTask } from './kanboardClient';
import { KanboardSession } from './session';

/** Tree item that carries a Kanboard URL so "Open in Browser" works on it. */
export class KanboardItem extends vscode.TreeItem {
	url?: string;
}

function messageItem(label: string, icon?: string): KanboardItem {
	const item = new KanboardItem(label, vscode.TreeItemCollapsibleState.None);
	if (icon) {
		item.iconPath = new vscode.ThemeIcon(icon);
	}
	return item;
}

function errorItem(err: unknown): KanboardItem {
	const message = err instanceof Error ? err.message : String(err);
	const item = messageItem('Error loading data', 'error');
	item.description = message;
	item.tooltip = message;
	return item;
}

function formatDate(timestamp: number | string | undefined): string | undefined {
	const value = Number(timestamp);
	if (!value) {
		return undefined;
	}
	return new Date(value * 1000).toLocaleDateString();
}

export class TaskItem extends KanboardItem {
	constructor(client: KanboardClient, readonly task: KanboardTask, options?: { showProject?: boolean }) {
		super(task.title, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon('circle-outline');
		this.url = client.taskUrl(task.id, task.project_id);
		this.contextValue = 'task';
		this.command = { command: 'kanboard.showTaskDetail', title: 'Show Task Details', arguments: [task] };

		const parts: string[] = [`#${task.id}`];
		if (options?.showProject && task.project_name) {
			parts.push(String(task.project_name));
		}
		if (task.column_name) {
			parts.push(String(task.column_name));
		}
		this.description = parts.join(' · ');

		const tooltip = new vscode.MarkdownString();
		tooltip.appendMarkdown(`**${task.title}** (#${task.id})\n\n`);
		if (task.project_name) {
			tooltip.appendMarkdown(`Project: ${task.project_name}\n\n`);
		}
		if (task.column_name) {
			tooltip.appendMarkdown(`Column: ${task.column_name}\n\n`);
		}
		const due = formatDate(task.date_due);
		if (due) {
			tooltip.appendMarkdown(`Due: ${due}\n\n`);
		}
		this.tooltip = tooltip;
	}
}

abstract class KanboardTreeProvider implements vscode.TreeDataProvider<KanboardItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(protected readonly session: KanboardSession) {
		session.onDidChange(() => this.refresh());
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: KanboardItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: KanboardItem): Promise<KanboardItem[]> {
		const client = this.session.client;
		if (!client) {
			return [];
		}
		try {
			return await this.load(client, element);
		} catch (err) {
			return element ? [] : [errorItem(err)];
		}
	}

	protected abstract load(client: KanboardClient, element?: KanboardItem): Promise<KanboardItem[]>;
}

class ProjectItem extends KanboardItem {
	constructor(client: KanboardClient, readonly project: KanboardProject, readonly tasks: KanboardTask[]) {
		super(
			project.name,
			tasks.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
		this.iconPath = new vscode.ThemeIcon('project');
		this.url = project.url?.board || client.boardUrl(project.id);
		this.contextValue = 'project';
		this.description = tasks.length === 1 ? '1 task' : `${tasks.length} tasks`;
		if (project.description) {
			this.tooltip = String(project.description);
		}
	}
}

/** "My Dashboard": my projects (getMyProjects), expandable into my open tasks per project. */
export class DashboardProvider extends KanboardTreeProvider {
	protected async load(client: KanboardClient, element?: KanboardItem): Promise<KanboardItem[]> {
		if (element instanceof ProjectItem) {
			return element.tasks.map((task) => new TaskItem(client, task));
		}
		const [projects, tasks] = await Promise.all([client.getMyProjects(), client.getMyDashboardTasks()]);
		if (!projects || projects.length === 0) {
			return [messageItem('No projects found', 'info')];
		}
		return projects.map(
			(project) =>
				new ProjectItem(client, project, tasks.filter((t) => String(t.project_id) === String(project.id)))
		);
	}
}

export interface MyTasksFilter {
	projectId: string;
	projectName: string;
	columnId?: string;
	columnName?: string;
}

/** "My Tasks": flat list of open tasks assigned to me, optionally filtered by project/column. */
export class MyTasksProvider extends KanboardTreeProvider {
	private filter: MyTasksFilter | undefined;

	setFilter(filter: MyTasksFilter | undefined): void {
		this.filter = filter;
		this.refresh();
	}

	protected async load(client: KanboardClient): Promise<KanboardItem[]> {
		let tasks = await client.getMyDashboardTasks();
		const filter = this.filter;
		if (filter) {
			tasks = tasks.filter(
				(t) =>
					String(t.project_id) === filter.projectId &&
					(!filter.columnId || String(t.column_id) === filter.columnId)
			);
		}
		if (tasks.length === 0) {
			return [messageItem(filter ? 'No tasks match the filter' : 'No tasks assigned to you', 'check')];
		}
		return tasks.map((task) => new TaskItem(client, task, { showProject: !filter }));
	}
}

/** "Overdue Tasks": tasks assigned to me whose due date already passed. */
export class OverdueTasksProvider extends KanboardTreeProvider {
	protected async load(client: KanboardClient): Promise<KanboardItem[]> {
		const tasks = await client.getMyOverdueTasks();
		if (!tasks || tasks.length === 0) {
			return [messageItem('Nothing overdue 🎉', 'check')];
		}
		return tasks.map((task) => {
			const item = new TaskItem(client, task, { showProject: true });
			item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('errorForeground'));
			const due = formatDate(task.date_due);
			if (due) {
				item.description = `${item.description} · due ${due}`;
			}
			return item;
		});
	}
}

/**
 * "My Activity": latest events from getMyActivityStream.
 * Kanboard returns activity for every project the user is member of, so the
 * stream is filtered here to events the user performed or events on tasks
 * assigned to the user.
 */
export class ActivityProvider extends KanboardTreeProvider {
	private showAll = false;

	setShowAll(showAll: boolean): void {
		this.showAll = showAll;
		this.refresh();
	}

	protected async load(client: KanboardClient): Promise<KanboardItem[]> {
		const [me, events] = await Promise.all([client.getMe(), client.getMyActivityStream()]);
		const myId = String(me.id);
		const visible = this.showAll
			? events || []
			: (events || []).filter(
					(event) => String(event.creator_id) === myId || String(event.task?.owner_id) === myId
				);
		if (visible.length === 0) {
			return [messageItem('No recent activity', 'info')];
		}
		return visible.slice(0, 50).map((event) => this.eventItem(client, event));
	}

	private eventItem(client: KanboardClient, event: KanboardEvent): KanboardItem {
		const label = event.event_title || 'Activity';
		const item = new KanboardItem(label, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon('pulse');
		item.description = formatDate(event.date_creation);
		if (event.task) {
			item.url = client.taskUrl(event.task.id, event.task.project_id);
			item.contextValue = 'event';
			item.command = { command: 'kanboard.showTaskDetail', title: 'Show Task Details', arguments: [event.task] };
		}
		if (event.event_content) {
			item.tooltip = new vscode.MarkdownString(String(event.event_content));
		}
		return item;
	}
}
