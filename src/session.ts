import * as vscode from 'vscode';
import { KanboardClient } from './kanboardClient';

const TOKEN_SECRET_KEY = 'kanboard.apiToken';

/**
 * Holds the active connection to a Kanboard instance.
 * URL and username live in user settings; the API token lives in secret storage.
 */
export class KanboardSession {
	private _client: KanboardClient | undefined;
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	get client(): KanboardClient | undefined {
		return this._client;
	}

	/** Rebuild the client from saved settings + secret, if everything is present. */
	async restore(): Promise<void> {
		const config = vscode.workspace.getConfiguration('kanboard');
		const url = config.get<string>('url')?.trim();
		const username = config.get<string>('username')?.trim();
		const token = await this.context.secrets.get(TOKEN_SECRET_KEY);
		this.setClient(url && username && token ? new KanboardClient(url, username, token) : undefined);
	}

	/** Interactive flow: ask for URL, username and token, validate them, then persist. */
	async connect(): Promise<boolean> {
		const config = vscode.workspace.getConfiguration('kanboard');

		const url = await vscode.window.showInputBox({
			title: 'Kanboard: instance URL',
			prompt: 'Base URL of your Kanboard instance',
			placeHolder: 'https://kanboard.example.com',
			value: config.get<string>('url') || '',
			ignoreFocusOut: true,
			validateInput: (value) =>
				/^https?:\/\/.+/i.test(value.trim()) ? undefined : 'Enter a valid URL starting with http:// or https://'
		});
		if (!url) {
			return false;
		}

		const username = await vscode.window.showInputBox({
			title: 'Kanboard: username',
			prompt: 'Your Kanboard username',
			value: config.get<string>('username') || '',
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : 'Username is required')
		});
		if (!username) {
			return false;
		}

		const token = await vscode.window.showInputBox({
			title: 'Kanboard: API token',
			prompt: 'Personal API token (Kanboard → Settings → API)',
			password: true,
			ignoreFocusOut: true,
			validateInput: (value) => (value.trim() ? undefined : 'API token is required')
		});
		if (!token) {
			return false;
		}

		const client = new KanboardClient(url.trim(), username.trim(), token.trim());
		try {
			const me = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: 'Connecting to Kanboard…' },
				() => client.getMe()
			);
			await config.update('url', url.trim(), vscode.ConfigurationTarget.Global);
			await config.update('username', username.trim(), vscode.ConfigurationTarget.Global);
			await this.context.secrets.store(TOKEN_SECRET_KEY, token.trim());
			this.setClient(client);
			vscode.window.showInformationMessage(`Kanboard: connected as ${me.name || me.username}`);
			return true;
		} catch (err) {
			vscode.window.showErrorMessage(
				`Kanboard: connection failed. ${err instanceof Error ? err.message : String(err)}`
			);
			return false;
		}
	}

	async disconnect(): Promise<void> {
		await this.context.secrets.delete(TOKEN_SECRET_KEY);
		this.setClient(undefined);
		vscode.window.showInformationMessage('Kanboard: disconnected.');
	}

	private setClient(client: KanboardClient | undefined): void {
		this._client = client;
		vscode.commands.executeCommand('setContext', 'kanboard.connected', client !== undefined);
		this._onDidChange.fire();
	}
}
