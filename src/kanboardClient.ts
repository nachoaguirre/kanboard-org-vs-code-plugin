/**
 * Minimal JSON-RPC 2.0 client for the Kanboard API.
 * Docs: https://docs.kanboard.org/v1/api/
 *
 * Authentication uses HTTP Basic Auth with the Kanboard username and the
 * user's personal API token (Settings > API in Kanboard).
 */

export interface KanboardProject {
	id: number | string;
	name: string;
	description?: string;
	is_active?: number | string;
	url?: { board?: string; list?: string; calendar?: string };
	[key: string]: unknown;
}

export interface KanboardTask {
	id: number | string;
	title: string;
	description?: string;
	project_id: number | string;
	project_name?: string;
	column_id?: number | string;
	column_name?: string;
	swimlane_id?: number | string;
	swimlane_name?: string;
	date_creation?: number | string;
	date_modification?: number | string;
	date_due?: number | string;
	priority?: number | string;
	color_id?: string;
	assignee_username?: string;
	nb_comments?: number | string;
	nb_subtasks?: number | string;
	nb_completed_subtasks?: number | string;
	tags?: { id: number | string; name: string }[];
	[key: string]: unknown;
}

export interface KanboardEvent {
	id: number | string;
	event_title?: string;
	event_content?: string;
	event_name?: string;
	date_creation?: number | string;
	author?: string;
	creator_id?: number | string;
	task?: KanboardTask;
	[key: string]: unknown;
}

export interface KanboardColumn {
	id: number | string;
	title: string;
	position?: number | string;
	project_id?: number | string;
	task_limit?: number | string;
	[key: string]: unknown;
}

export interface KanboardComment {
	id: number | string;
	comment: string;
	date_creation?: number | string;
	username?: string;
	name?: string;
	[key: string]: unknown;
}

export interface KanboardSubtask {
	id: number | string;
	title: string;
	status?: number | string;
	status_name?: string;
	username?: string;
	name?: string;
	[key: string]: unknown;
}

export interface KanboardUser {
	id: number | string;
	username: string;
	name?: string;
	email?: string;
	[key: string]: unknown;
}


interface JsonRpcResponse {
	jsonrpc: string;
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

export class KanboardError extends Error {}

export class KanboardClient {
	private readonly baseUrl: string;
	private requestId = 1;

	constructor(
		baseUrl: string,
		private readonly username: string,
		private readonly token: string
	) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
	}

	get instanceUrl(): string {
		return this.baseUrl;
	}

	taskUrl(taskId: number | string, projectId: number | string): string {
		return `${this.baseUrl}/?controller=TaskViewController&action=show&task_id=${taskId}&project_id=${projectId}`;
	}

	boardUrl(projectId: number | string): string {
		return `${this.baseUrl}/?controller=BoardViewController&action=show&project_id=${projectId}`;
	}

	async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
		const endpoint = `${this.baseUrl}/jsonrpc.php`;
		let response: Response;
		try {
			response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': 'Basic ' + Buffer.from(`${this.username}:${this.token}`).toString('base64')
				},
				body: JSON.stringify({ jsonrpc: '2.0', method, id: this.requestId++, params })
			});
		} catch (err) {
			throw new KanboardError(`Could not reach ${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
		}

		if (response.status === 401 || response.status === 403) {
			throw new KanboardError('Authentication failed. Check your username and API token.');
		}
		if (!response.ok) {
			throw new KanboardError(`Kanboard returned HTTP ${response.status} for "${method}".`);
		}

		let payload: JsonRpcResponse;
		try {
			payload = (await response.json()) as JsonRpcResponse;
		} catch {
			throw new KanboardError(`Kanboard did not return valid JSON. Is "${this.baseUrl}" the correct base URL?`);
		}

		if (payload.error) {
			throw new KanboardError(`"${method}" failed: ${payload.error.message} (code ${payload.error.code})`);
		}
		return payload.result as T;
	}

	private mePromise: Promise<KanboardUser> | undefined;

	/** Current user, cached for the lifetime of the client. */
	getMe(): Promise<KanboardUser> {
		if (!this.mePromise) {
			this.mePromise = this.request<KanboardUser>('getMe');
			this.mePromise.catch(() => (this.mePromise = undefined));
		}
		return this.mePromise;
	}

	/**
	 * Open tasks assigned to the current user.
	 * On Kanboard 1.2.x getMyDashboard returns a flat array of tasks; older
	 * versions returned an object with a "tasks" key. Both shapes are handled.
	 */
	async getMyDashboardTasks(): Promise<KanboardTask[]> {
		const result = await this.request<unknown>('getMyDashboard');
		if (Array.isArray(result)) {
			return result as KanboardTask[];
		}
		if (result && typeof result === 'object' && Array.isArray((result as { tasks?: unknown }).tasks)) {
			return (result as { tasks: KanboardTask[] }).tasks;
		}
		return [];
	}

	/** Projects the current user is member of, including board/list URLs. */
	getMyProjects(): Promise<KanboardProject[]> {
		return this.request<KanboardProject[]>('getMyProjects');
	}

	getMyActivityStream(): Promise<KanboardEvent[]> {
		return this.request<KanboardEvent[]>('getMyActivityStream');
	}

	getMyOverdueTasks(): Promise<KanboardTask[]> {
		return this.request<KanboardTask[]>('getMyOverdueTasks');
	}

	/** Returns a map of project id => project name for the current user. */
	getMyProjectsList(): Promise<Record<string, string>> {
		return this.request<Record<string, string>>('getMyProjectsList');
	}

	getTask(taskId: number | string): Promise<KanboardTask> {
		return this.request<KanboardTask>('getTask', { task_id: Number(taskId) });
	}

	getProjectById(projectId: number | string): Promise<KanboardProject> {
		return this.request<KanboardProject>('getProjectById', { project_id: Number(projectId) });
	}

	getColumns(projectId: number | string): Promise<KanboardColumn[]> {
		return this.request<KanboardColumn[]>('getColumns', { project_id: Number(projectId) });
	}

	getAllComments(taskId: number | string): Promise<KanboardComment[]> {
		return this.request<KanboardComment[]>('getAllComments', { task_id: Number(taskId) });
	}

	getAllSubtasks(taskId: number | string): Promise<KanboardSubtask[]> {
		return this.request<KanboardSubtask[]>('getAllSubtasks', { task_id: Number(taskId) });
	}

	/** Returns a map of tag id => tag name for the task. */
	getTaskTags(taskId: number | string): Promise<Record<string, string>> {
		return this.request<Record<string, string>>('getTaskTags', { task_id: Number(taskId) });
	}

	moveTaskPosition(
		projectId: number | string,
		taskId: number | string,
		columnId: number | string,
		position: number,
		swimlaneId: number | string
	): Promise<boolean> {
		return this.request<boolean>('moveTaskPosition', {
			project_id: Number(projectId),
			task_id: Number(taskId),
			column_id: Number(columnId),
			position,
			swimlane_id: Number(swimlaneId)
		});
	}

	closeTask(taskId: number | string): Promise<boolean> {
		return this.request<boolean>('closeTask', { task_id: Number(taskId) });
	}

	createTask(title: string, projectId: number | string, description?: string): Promise<number | false> {
		const params: Record<string, unknown> = { title, project_id: Number(projectId) };
		if (description) {
			params.description = description;
		}
		return this.request<number | false>('createTask', params);
	}
}
