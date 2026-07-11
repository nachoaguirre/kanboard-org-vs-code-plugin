import * as vscode from 'vscode';
import { KanboardTask } from './kanboardClient';
import { KanboardSession } from './session';
import { KanboardStatusBar } from './statusBar';
import { closeTaskInteractive, moveTaskInteractive } from './taskActions';
import { TaskDetailPanel } from './taskDetail';
import {
	ActivityProvider,
	DashboardProvider,
	KanboardItem,
	MyTasksFilter,
	MyTasksProvider,
	OverdueTasksProvider,
	TaskItem
} from './views';

export async function activate(context: vscode.ExtensionContext) {
	const session = new KanboardSession(context);

	const dashboard = new DashboardProvider(session);
	const myTasks = new MyTasksProvider(session);
	const overdueTasks = new OverdueTasksProvider(session);
	const activity = new ActivityProvider(session);
	const providers = [dashboard, myTasks, overdueTasks, activity];

	const statusBar = new KanboardStatusBar(session);
	const myTasksView = vscode.window.createTreeView('kanboard.myTasks', { treeDataProvider: myTasks });
	const activityView = vscode.window.createTreeView('kanboard.activity', { treeDataProvider: activity });

	const applyActivityScope = (showAll: boolean) => {
		activity.setShowAll(showAll);
		activityView.description = showAll ? 'Team' : undefined;
		vscode.commands.executeCommand('setContext', 'kanboard.activityShowAll', showAll);
	};

	const refreshAll = () => {
		providers.forEach((p) => p.refresh());
		statusBar.update();
	};

	const applyMyTasksFilter = (filter: MyTasksFilter | undefined) => {
		myTasks.setFilter(filter);
		myTasksView.description = filter
			? [filter.projectName, filter.columnName].filter(Boolean).join(' · ')
			: undefined;
		vscode.commands.executeCommand('setContext', 'kanboard.myTasksFiltered', filter !== undefined);
	};

	const showError = (err: unknown) =>
		vscode.window.showErrorMessage(`Kanboard: ${err instanceof Error ? err.message : String(err)}`);

	context.subscriptions.push(
		statusBar,
		myTasksView,
		activityView,
		vscode.window.registerTreeDataProvider('kanboard.dashboard', dashboard),
		vscode.window.registerTreeDataProvider('kanboard.overdueTasks', overdueTasks),

		vscode.commands.registerCommand('kanboard.connect', () => session.connect()),
		vscode.commands.registerCommand('kanboard.disconnect', () => session.disconnect()),
		vscode.commands.registerCommand('kanboard.refresh', refreshAll),

		vscode.commands.registerCommand('kanboard.openInBrowser', (item?: KanboardItem) => {
			if (item?.url) {
				vscode.env.openExternal(vscode.Uri.parse(item.url));
			}
		}),

		vscode.commands.registerCommand('kanboard.showTaskDetail', async (task?: KanboardTask) => {
			if (!session.client || !task?.id || !task.project_id) {
				return;
			}
			try {
				await TaskDetailPanel.show(session.client, task.id, task.project_id, refreshAll);
			} catch (err) {
				showError(err);
			}
		}),

		vscode.commands.registerCommand('kanboard.moveTask', async (item?: TaskItem) => {
			if (!session.client || !item?.task) {
				return;
			}
			try {
				if (await moveTaskInteractive(session.client, item.task.id, item.task.project_id)) {
					refreshAll();
				}
			} catch (err) {
				showError(err);
			}
		}),

		vscode.commands.registerCommand('kanboard.closeTask', async (item?: TaskItem) => {
			if (!session.client || !item?.task) {
				return;
			}
			try {
				if (await closeTaskInteractive(session.client, item.task.id, item.task.title)) {
					refreshAll();
				}
			} catch (err) {
				showError(err);
			}
		}),

		vscode.commands.registerCommand('kanboard.filterMyTasks', async () => {
			const client = session.client;
			if (!client) {
				return;
			}
			try {
				const projects = await client.getMyProjectsList();
				const projectPicks = [
					{ label: '$(clear-all) All projects', id: undefined as string | undefined },
					...Object.entries(projects || {}).map(([id, name]) => ({ label: name, id: id as string | undefined }))
				];
				const projectPick = await vscode.window.showQuickPick(projectPicks, {
					title: 'Filter My Tasks',
					placeHolder: 'Select a project'
				});
				if (!projectPick) {
					return;
				}
				if (!projectPick.id) {
					applyMyTasksFilter(undefined);
					return;
				}

				const columns = await client.getColumns(projectPick.id);
				const columnPicks = [
					{ label: '$(clear-all) All columns', column: undefined as (typeof columns)[number] | undefined },
					...columns.map((column) => ({ label: column.title, column: column as (typeof columns)[number] | undefined }))
				];
				const columnPick = await vscode.window.showQuickPick(columnPicks, {
					title: `Filter My Tasks · ${projectPick.label}`,
					placeHolder: 'Select a column (optional)'
				});
				if (!columnPick) {
					return;
				}
				applyMyTasksFilter({
					projectId: projectPick.id,
					projectName: projectPick.label,
					columnId: columnPick.column ? String(columnPick.column.id) : undefined,
					columnName: columnPick.column?.title
				});
			} catch (err) {
				showError(err);
			}
		}),

		vscode.commands.registerCommand('kanboard.clearMyTasksFilter', () => applyMyTasksFilter(undefined)),

		vscode.commands.registerCommand('kanboard.showTeamActivity', () => applyActivityScope(true)),
		vscode.commands.registerCommand('kanboard.showMyActivityOnly', () => applyActivityScope(false)),

		vscode.commands.registerCommand('kanboard.diagnostics', async () => {
			const client = session.client;
			if (!client) {
				vscode.window.showWarningMessage('Kanboard: connect first (Kanboard: Connect to Kanboard).');
				return;
			}
			const channel = vscode.window.createOutputChannel('Kanboard Diagnostics');
			context.subscriptions.push(channel);
			channel.clear();
			channel.show(true);
			channel.appendLine(`Instance: ${client.instanceUrl}`);
			const methods = ['getMe', 'getVersion', 'getMyProjectsList', 'getMyProjects', 'getMyDashboard', 'getMyOverdueTasks'];
			for (const method of methods) {
				channel.appendLine(`\n========== ${method} ==========`);
				try {
					const result = await client.request<unknown>(method);
					const json = JSON.stringify(result, null, 2) ?? 'null';
					channel.appendLine(json.length > 6000 ? json.slice(0, 6000) + '\n… (truncated)' : json);
				} catch (err) {
					channel.appendLine(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
		}),

		vscode.commands.registerCommand('kanboard.createTask', async () => {
			const client = session.client;
			if (!client) {
				const connected = await session.connect();
				if (!connected) {
					return;
				}
				return vscode.commands.executeCommand('kanboard.createTask');
			}

			let projectsById: Record<string, string>;
			try {
				projectsById = await client.getMyProjectsList();
			} catch (err) {
				showError(err);
				return;
			}

			const picks = Object.entries(projectsById || {}).map(([id, name]) => ({ label: name, id }));
			if (picks.length === 0) {
				vscode.window.showWarningMessage('Kanboard: you have no projects to create tasks in.');
				return;
			}

			const project = await vscode.window.showQuickPick(picks, {
				title: 'Kanboard: create task',
				placeHolder: 'Select a project'
			});
			if (!project) {
				return;
			}

			const title = await vscode.window.showInputBox({
				title: `New task in "${project.label}"`,
				prompt: 'Task title',
				ignoreFocusOut: true,
				validateInput: (value) => (value.trim() ? undefined : 'Title is required')
			});
			if (!title) {
				return;
			}

			try {
				const taskId = await client.createTask(title.trim(), project.id);
				if (taskId === false) {
					throw new Error('Kanboard rejected the task.');
				}
				const open = 'Open in Browser';
				vscode.window
					.showInformationMessage(`Kanboard: task #${taskId} created in "${project.label}".`, open)
					.then((choice) => {
						if (choice === open) {
							vscode.env.openExternal(vscode.Uri.parse(client.taskUrl(taskId, project.id)));
						}
					});
				refreshAll();
			} catch (err) {
				showError(err);
			}
		})
	);

	await session.restore();
}

export function deactivate() {}
