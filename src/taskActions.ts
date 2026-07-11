import * as vscode from 'vscode';
import { KanboardClient } from './kanboardClient';

/**
 * Ask for a target column and move the task there (top of the column).
 * Returns true if the task was moved.
 */
export async function moveTaskInteractive(
	client: KanboardClient,
	taskId: number | string,
	projectId: number | string
): Promise<boolean> {
	const [task, columns] = await Promise.all([client.getTask(taskId), client.getColumns(projectId)]);

	const picks = columns.map((column) => ({
		label: column.title,
		description: String(column.id) === String(task.column_id) ? 'current column' : undefined,
		column
	}));
	const pick = await vscode.window.showQuickPick(picks, {
		title: `Move #${task.id} "${task.title}"`,
		placeHolder: 'Select target column'
	});
	if (!pick || String(pick.column.id) === String(task.column_id)) {
		return false;
	}

	const moved = await client.moveTaskPosition(projectId, taskId, pick.column.id, 1, Number(task.swimlane_id) || 1);
	if (!moved) {
		throw new Error('Kanboard rejected the move.');
	}
	vscode.window.showInformationMessage(`Kanboard: #${task.id} moved to "${pick.label}".`);
	return true;
}

/**
 * Confirm and close the task. Returns true if the task was closed.
 */
export async function closeTaskInteractive(
	client: KanboardClient,
	taskId: number | string,
	title?: string
): Promise<boolean> {
	const closeAction = 'Close Task';
	const choice = await vscode.window.showWarningMessage(
		`Close task #${taskId}${title ? ` "${title}"` : ''}? You can reopen it later from Kanboard.`,
		closeAction
	);
	if (choice !== closeAction) {
		return false;
	}

	const closed = await client.closeTask(taskId);
	if (!closed) {
		throw new Error('Kanboard rejected closing the task.');
	}
	vscode.window.showInformationMessage(`Kanboard: task #${taskId} closed.`);
	return true;
}
