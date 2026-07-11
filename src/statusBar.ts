import * as vscode from 'vscode';
import { KanboardSession } from './session';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Status bar item showing open tasks assigned to me, highlighted when
 * something is overdue. Clicking it focuses the My Tasks view.
 */
export class KanboardStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private readonly timer: NodeJS.Timeout;

	constructor(private readonly session: KanboardSession) {
		this.item = vscode.window.createStatusBarItem('kanboard.status', vscode.StatusBarAlignment.Left, 100);
		this.item.name = 'Kanboard';
		this.item.command = 'kanboard.myTasks.focus';
		session.onDidChange(() => this.update());
		this.timer = setInterval(() => this.update(), REFRESH_INTERVAL_MS);
	}

	async update(): Promise<void> {
		const client = this.session.client;
		if (!client) {
			this.item.hide();
			return;
		}
		try {
			const [tasks, overdue] = await Promise.all([client.getMyDashboardTasks(), client.getMyOverdueTasks()]);
			const overdueCount = overdue?.length ?? 0;
			this.item.text =
				overdueCount > 0
					? `$(tasklist) ${tasks.length} $(warning) ${overdueCount}`
					: `$(tasklist) ${tasks.length}`;
			this.item.backgroundColor =
				overdueCount > 0 ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
			this.item.tooltip =
				`Kanboard: ${tasks.length} open task(s) assigned to you` +
				(overdueCount > 0 ? `, ${overdueCount} overdue` : '');
		} catch (err) {
			this.item.text = '$(tasklist) $(warning)';
			this.item.backgroundColor = undefined;
			this.item.tooltip = `Kanboard: ${err instanceof Error ? err.message : String(err)}`;
		}
		this.item.show();
	}

	dispose(): void {
		clearInterval(this.timer);
		this.item.dispose();
	}
}
