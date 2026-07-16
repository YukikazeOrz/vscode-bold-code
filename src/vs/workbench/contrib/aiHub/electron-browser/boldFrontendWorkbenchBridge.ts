/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, extname } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { IBrowserViewService, ipcBrowserViewChannelName } from '../../../../platform/browserView/common/browserView.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { BoldFrontendAction, BoldFrontendMode, BoldFrontendProvider, IBoldFrontendAiSettings, IBoldFrontendBridge, IBoldFrontendDocument, IBoldFrontendFileEntry, IBoldFrontendSearchResult, IBoldFrontendSSHHost, IBoldFrontendState, IBoldGatewayAccount } from '../frontend/boldFrontendProtocol.js';
import { IAiConfigService, IAiHubModeController } from './aiHubTypes.js';
import { BoldGatewayController } from './boldGatewayController.js';
import { BoldTerminalController } from './boldTerminalController.js';

const FRONTEND_ACTION_COMMANDS: Readonly<Record<BoldFrontendAction, string>> = {
	newFile: 'workbench.action.files.newUntitledFile',
	terminal: 'workbench.action.terminal.toggleTerminal',
};

const GATEWAY_API_KEY_STORAGE_PREFIX = 'aiHub.gatewayApiKey.';
const SEARCH_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.build', 'out', 'dist', 'build', 'VSCode-darwin-arm64', 'VSCode-reh-darwin-arm64', 'VSCode-reh-web-darwin-arm64']);
const SEARCH_MAX_FILES = 1200;
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_MAX_RESULTS = 80;
const SEARCH_MAX_MATCHES_PER_FILE = 4;

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
	'.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cs': 'csharp', '.css': 'css', '.go': 'go',
	'.html': 'html', '.java': 'java', '.js': 'javascript', '.json': 'json', '.jsx': 'javascript',
	'.md': 'markdown', '.py': 'python', '.rs': 'rust', '.scss': 'scss', '.sh': 'shell', '.sql': 'sql',
	'.swift': 'swift', '.toml': 'ini', '.ts': 'typescript', '.tsx': 'typescript', '.xml': 'xml',
	'.yaml': 'yaml', '.yml': 'yaml',
};

/** VS Code adapter for the independent frontend protocol. */
export class BoldFrontendWorkbenchBridge extends Disposable implements IBoldFrontendBridge {

	private readonly listeners = new Set<(state: IBoldFrontendState) => void>();
	private stateRequest = 0;
	private searchActive = false;
	private readonly gatewayController: BoldGatewayController | undefined;
	private readonly terminalController: BoldTerminalController;

	constructor(
		@IAiConfigService private readonly aiConfigService: IAiConfigService,
		@IAiHubModeController private readonly modeController: IAiHubModeController,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IProductService productService: IProductService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IHostService private readonly hostService: IHostService,
		@ICommandService private readonly commandService: ICommandService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		const browserViewService = ProxyChannel.toService<IBrowserViewService>(mainProcessService.getChannel(ipcBrowserViewChannelName));
		this.gatewayController = productService.aiGatewayUrl ? this._register(new BoldGatewayController(
			mainWindow.document,
			mainWindow.vscodeWindowId,
			productService.aiGatewayUrl,
			browserViewService,
			(provider, baseUrl, apiKey) => provider === 'claude'
				? this.aiConfigService.saveClaudeSettings({ baseUrl, apiKey })
				: this.aiConfigService.saveCodexSettings({ baseUrl, apiKey }),
			() => void this.emitState(),
		)) : undefined;
		this.terminalController = this._register(new BoldTerminalController(mainWindow.document, mainProcessService, workspaceContextService, environmentService));
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => void this.emitState()));
		this._register(this.workspaceContextService.onDidChangeWorkspaceName(() => void this.emitState()));
	}

	async getState(): Promise<IBoldFrontendState> {
		await this.modeController.initialize();
		const [aiState, gateway] = await Promise.all([
			this.aiConfigService.getState(),
			this.getGatewayAccount(),
		]);
		const mode = this.modeController.mode;
		const workspace = this.workspaceContextService.getWorkspace();
		const workspaceRoots = workspace.folders.map(folder => ({
			name: folder.name,
			uri: folder.uri.toString(),
			directory: true,
		}));

		return {
			mode,
			workspaceName: workspace.folders.length === 1
				? workspace.folders[0].name
				: workspace.folders.length > 1 ? '多根工作区' : '未打开文件夹',
			workspaceRoots,
			// Tabs are owned solely by BoldFrontendApp's in-memory editor models.
			// Do not mirror native editor groups: doing so lets a click escape to a
			// VS Code editor window instead of switching the visible Bold tab.
			tabs: [],
			claudeEnabled: aiState.claudeEnabled,
			codexEnabled: aiState.codexEnabled,
			gatewayStatus: gateway.status,
			gatewayBalance: gateway.balance,
			gatewayTodayUsage: gateway.todayUsage,
			editChatProvider: aiState.editChatProvider,
			searchActive: this.searchActive,
			terminalActive: this.terminalController.isOpen(),
		};
	}

	async listDirectory(uri: string): Promise<readonly IBoldFrontendFileEntry[]> {
		const resource = this.validateWorkspaceResource(uri);
		const stat = await this.fileService.resolve(resource, { resolveSingleChildDescendants: false });
		return (stat.children ?? [])
			.filter(child => child.name !== '.git')
			.map(child => ({ name: child.name, uri: child.resource.toString(), directory: child.isDirectory }))
			.sort((left, right) => left.directory === right.directory
				? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
				: left.directory ? -1 : 1);
	}

	async searchWorkspace(query: string): Promise<readonly IBoldFrontendSearchResult[]> {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return [];
		}
		const roots = this.workspaceContextService.getWorkspace().folders;
		const results: IBoldFrontendSearchResult[] = [];
		let visitedFiles = 0;
		const visit = async (resource: URI, root: URI): Promise<void> => {
			if (results.length >= SEARCH_MAX_RESULTS || visitedFiles >= SEARCH_MAX_FILES) {
				return;
			}
			let stat;
			try {
				stat = await this.fileService.resolve(resource, { resolveSingleChildDescendants: false });
			} catch {
				return;
			}
			if (stat.isDirectory) {
				if (SEARCH_IGNORED_DIRECTORIES.has(stat.name)) {
					return;
				}
				for (const child of stat.children ?? []) {
					await visit(child.resource, root);
					if (results.length >= SEARCH_MAX_RESULTS || visitedFiles >= SEARCH_MAX_FILES) {
						return;
					}
				}
				return;
			}
			visitedFiles++;
			if ((stat.size ?? 0) > SEARCH_MAX_FILE_BYTES || this.isLikelyBinary(stat.name)) {
				return;
			}
			let contents: string;
			try {
				contents = (await this.fileService.readFile(resource)).value.toString();
			} catch {
				return;
			}
			const matches = [];
			const lines = contents.split(/\r?\n/);
			for (let index = 0; index < lines.length && matches.length < SEARCH_MAX_MATCHES_PER_FILE; index++) {
				const line = lines[index];
				const matchIndex = line.toLowerCase().indexOf(needle);
				if (matchIndex === -1) {
					continue;
				}
				const start = Math.max(0, matchIndex - 48);
				const end = Math.min(line.length, matchIndex + needle.length + 72);
				matches.push({ line: index + 1, preview: line.slice(start, end).trim() });
			}
			if (matches.length) {
				results.push({
					uri: resource.toString(),
					name: basename(resource),
					path: this.relativeWorkspacePath(root, resource),
					matches,
				});
			}
		};
		for (const root of roots) {
			await visit(root.uri, root.uri);
		}
		return results;
	}

	async listSSHHosts(): Promise<readonly IBoldFrontendSSHHost[]> {
		return this.readSSHConfigHosts();
	}

	async connectSSHHost(host: string): Promise<void> {
		const trimmed = host.trim();
		if (!trimmed) {
			throw new Error('SSH 主机不能为空');
		}
		this.terminalController.hide();
		await this.setSearchActive(false);
		// `vscode.newWindow` is a menu command, not the native window-opening API.
		// Calling it with an options object silently leaves Remote-SSH unresolved.
		await this.hostService.openWindow({
			remoteAuthority: `ssh-remote+${trimmed}`,
			forceReuseWindow: true,
		});
	}

	async openSSHConfig(): Promise<void> {
		await this.commandService.executeCommand('openremotessh.openConfigFile');
	}

	async openFile(uri: string): Promise<IBoldFrontendDocument> {
		const resource = this.validateWorkspaceResource(uri);
		const contents = await this.fileService.readFile(resource);
		return {
			uri: resource.toString(),
			name: basename(resource),
			languageId: LANGUAGE_BY_EXTENSION[extname(resource).toLowerCase()] ?? 'plaintext',
			contents: contents.value.toString(),
		};
	}

	async saveFile(uri: string, contents: string): Promise<void> {
		const resource = this.validateWorkspaceResource(uri);
		await this.fileService.writeFile(resource, VSBuffer.fromString(contents), { atomic: { postfix: '.bold-tmp' } });
	}

	async runAction(action: BoldFrontendAction): Promise<void> {
		if (action === 'terminal') {
			await this.modeController.setMode('edit');
			await this.setSearchActive(false);
			if (this.terminalController.isOpen()) {
				this.terminalController.hide();
			} else {
				await this.terminalController.show();
			}
			await this.emitState();
			return;
		}
		await this.commandService.executeCommand(FRONTEND_ACTION_COMMANDS[action]);
	}

	private async readSSHConfigHosts(): Promise<readonly IBoldFrontendSSHHost[]> {
		const config = URI.joinPath(this.environmentService.userHome, '.ssh', 'config');
		let contents: string;
		try {
			contents = (await this.fileService.readFile(config)).value.toString();
		} catch {
			return [];
		}
		const hosts: Array<{ alias: string; destination?: string; detail?: string }> = [];
		let current: { aliases: string[]; hostName?: string; user?: string; port?: string } | undefined;
		const flush = () => {
			if (!current) {
				return;
			}
			for (const alias of current.aliases) {
				const destination = current.hostName && current.hostName !== alias ? current.hostName : undefined;
				const endpoint = `${current.user ? `${current.user}@` : ''}${current.hostName ?? alias}${current.port ? `:${current.port}` : ''}`;
				hosts.push({ alias, destination, detail: endpoint !== alias ? endpoint : undefined });
			}
		};
		for (const rawLine of contents.split(/\r?\n/)) {
			const line = rawLine.replace(/\s+#.*$/, '').trim();
			if (!line) {
				continue;
			}
			const match = /^(\S+)\s+(.+)$/.exec(line);
			if (!match) {
				continue;
			}
			const key = match[1].toLowerCase();
			const value = match[2].trim();
			if (key === 'host') {
				flush();
				current = { aliases: value.split(/\s+/).filter(alias => !/[!*?]/.test(alias)) };
			} else if (current && key === 'hostname') {
				current.hostName = value;
			} else if (current && key === 'user') {
				current.user = value;
			} else if (current && key === 'port') {
				current.port = value;
			}
		}
		flush();
		return hosts.filter((host, index) => hosts.findIndex(candidate => candidate.alias === host.alias) === index);
	}

	async toggleSearch(): Promise<void> {
		const next = !this.searchActive;
		if (next) {
			await this.modeController.setMode('edit');
			this.terminalController.hide();
		}
		await this.setSearchActive(next);
		await this.emitState();
	}

	async setMode(mode: BoldFrontendMode): Promise<void> {
		this.terminalController.hide();
		await this.setSearchActive(false);
		await this.modeController.setMode(mode);
		await this.emitState();
	}

	async setEditChatProvider(provider: BoldFrontendProvider): Promise<void> {
		await this.modeController.setEditChatProvider(provider);
		await this.emitState();
	}

	async getAiSettings(): Promise<IBoldFrontendAiSettings> {
		const [state, gateway] = await Promise.all([
			this.aiConfigService.getState(),
			this.getGatewayAccount(true),
		]);
		return {
			claudeBaseUrl: state.claudeBaseUrl,
			claudeHasApiKey: state.claudeHasApiKey,
			codexBaseUrl: state.codexBaseUrl,
			codexHasApiKey: state.codexHasApiKey,
			editChatProvider: state.editChatProvider,
			claudeGatewayApiKeyId: this.getSelectedGatewayApiKey('claude'),
			codexGatewayApiKeyId: this.getSelectedGatewayApiKey('codex'),
			gateway,
		};
	}

	async saveAiSettings(provider: 'claude' | 'codex', baseUrl: string, apiKey: string): Promise<void> {
		if (!apiKey) {
			return;
		}
		if (provider === 'claude') {
			await this.aiConfigService.saveClaudeSettings({ baseUrl, apiKey });
		} else {
			await this.aiConfigService.saveCodexSettings({ baseUrl, apiKey });
		}
		this.storageService.remove(`${GATEWAY_API_KEY_STORAGE_PREFIX}${provider}`, StorageScope.PROFILE);
		await this.emitState();
	}

	async checkForExtensionUpdate(provider: BoldFrontendProvider): Promise<boolean> {
		// Keep the settings DOM mounted so its in-place update result remains visible.
		return this.aiConfigService.checkForExtensionUpdate(provider);
	}

	async selectGatewayApi(provider: BoldFrontendProvider, apiKeyId: number): Promise<void> {
		if (!this.gatewayController) {
			throw new Error('AI Gateway 未配置');
		}
		await this.gatewayController.selectApi(provider, apiKeyId);
		this.storageService.store(`${GATEWAY_API_KEY_STORAGE_PREFIX}${provider}`, String(apiKeyId), StorageScope.PROFILE, StorageTarget.USER);
		await this.emitState();
	}

	async updateGatewayApiGroup(apiKeyId: number, groupId: number): Promise<void> {
		if (!this.gatewayController) {
			throw new Error('AI Gateway 未配置');
		}
		await this.gatewayController.updateApiGroup(apiKeyId, groupId);
	}

	async openGatewayApiCreation(): Promise<void> {
		if (!this.gatewayController) {
			throw new Error('AI Gateway 未配置');
		}
		await this.gatewayController.openApiCreation();
	}

	async logoutGateway(): Promise<void> {
		await this.gatewayController?.logout();
		this.storageService.remove(`${GATEWAY_API_KEY_STORAGE_PREFIX}claude`, StorageScope.PROFILE);
		this.storageService.remove(`${GATEWAY_API_KEY_STORAGE_PREFIX}codex`, StorageScope.PROFILE);
	}

	async openGateway(): Promise<void> {
		await this.gatewayController?.toggle();
	}

	async openSettings(): Promise<void> { }

	private getSelectedGatewayApiKey(provider: BoldFrontendProvider): number | undefined {
		const value = Number(this.storageService.get(`${GATEWAY_API_KEY_STORAGE_PREFIX}${provider}`, StorageScope.PROFILE));
		return Number.isFinite(value) && value > 0 ? value : undefined;
	}

	private async getGatewayAccount(force = false): Promise<IBoldGatewayAccount> {
		return this.gatewayController?.getAccount(force) ?? { status: 'unavailable', apiKeys: [], groups: [], message: 'AI Gateway 未配置' };
	}

	private async setSearchActive(active: boolean): Promise<void> {
		if (this.searchActive === active) {
			return;
		}
		this.searchActive = active;
		this.modeController.setEnforcementSuspended(active);
	}

	private relativeWorkspacePath(root: URI, resource: URI): string {
		const rootPath = root.path.endsWith('/') ? root.path : `${root.path}/`;
		return resource.path.startsWith(rootPath) ? resource.path.slice(rootPath.length) : resource.path;
	}

	private isLikelyBinary(name: string): boolean {
		return /\.(png|jpe?g|gif|webp|ico|icns|pdf|zip|gz|tar|dmg|vsix|node|wasm|mp4|mov|mp3|wav)$/i.test(name);
	}

	subscribe(listener: (state: IBoldFrontendState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private validateWorkspaceResource(value: string): URI {
		const resource = URI.parse(value);
		const isWorkspaceRoot = this.workspaceContextService.getWorkspace().folders.some(folder => folder.uri.toString() === resource.toString());
		if (!isWorkspaceRoot && !this.workspaceContextService.isInsideWorkspace(resource)) {
			throw new Error('The requested resource is outside the current workspace.');
		}
		return resource;
	}

	private async emitState(): Promise<void> {
		const request = ++this.stateRequest;
		const state = await this.getState();
		if (request !== this.stateRequest) {
			return;
		}
		for (const listener of this.listeners) {
			listener(state);
		}
	}
}
