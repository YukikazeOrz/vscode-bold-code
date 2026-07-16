/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorConstructionOptions } from '../../../../editor/browser/config/editorConfiguration.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { BoldFrontendAction, BoldFrontendMode, BoldFrontendProvider, IBoldFrontendBridge, IBoldFrontendFileEntry, IBoldFrontendSearchResult, IBoldFrontendSSHHost, IBoldFrontendState, IBoldFrontendTab } from './boldFrontendProtocol.js';

export interface IBoldFrontendEditorRuntime {
	createEditor(host: HTMLElement, options: Readonly<IEditorConstructionOptions>): ICodeEditor;
	createModel(contents: string, languageId: string, uri: URI): ITextModel;
}

interface IButtonOptions {
	readonly className?: string;
	readonly icon: string;
	readonly label: string;
	readonly title?: string;
	readonly onClick: () => void;
}

interface IOpenDocument {
	readonly id: string;
	readonly name: string;
	readonly model: ITextModel;
	readonly modelListener: IDisposable;
	savedAlternativeVersionId: number;
}

/** A standalone, framework-free frontend. It depends only on the narrow bridge above. */
export class BoldFrontendApp {

	readonly element: HTMLElement;

	private readonly disposers: Array<() => void> = [];
	private readonly workspaceTree: HTMLElement;
	private readonly searchPanel: HTMLElement;
	private readonly searchInput: HTMLInputElement;
	private readonly searchResults: HTMLElement;
	private readonly searchSummary: HTMLElement;
	private readonly sshButton: HTMLElement;
	private readonly sshPanel: HTMLElement;
	private readonly sshInput: HTMLInputElement;
	private readonly sshHosts: HTMLElement;
	private readonly sshStatus: HTMLElement;
	private readonly tabs: HTMLElement;
	private readonly workspaceTitle: HTMLElement;
	private readonly searchButton: HTMLElement;
	private readonly terminalButton: HTMLElement;
	private readonly connectionStatus: HTMLElement;
	private readonly providerStatus: HTMLElement;
	private readonly editorHost: HTMLElement;
	private readonly emptyEditor: HTMLElement;
	private readonly agentSurface: HTMLElement;
	private readonly agentTitle: HTMLElement;
	private readonly agentDetail: HTMLElement;
	private readonly transitionOverlay: HTMLElement;
	private readonly transitionTitle: HTMLElement;
	private readonly transitionDetail: HTMLElement;
	private editor: ICodeEditor | undefined;
	private editorInitialization: Promise<void> | undefined;
	private readonly settingsDrawer: HTMLElement;
	private readonly settingsBody: HTMLElement;
	private readonly expandedFolders = new Set<string>();
	private readonly openDocuments = new Map<string, IOpenDocument>();
	private workspaceSignature = '';
	private state: IBoldFrontendState | undefined;
	private activeDocumentId: string | undefined;
	private untitledCounter = 0;
	private stateApplication = 0;
	private switchingMode = false;
	private pendingMode: BoldFrontendMode | undefined;
	private settingsReturnFocus: HTMLElement | undefined;
	private searchRequest = 0;
	private searchTimer: number | undefined;
	private sshActive = false;

	constructor(
		private readonly document: Document,
		private readonly bridge: IBoldFrontendBridge,
		private readonly editorRuntime: IBoldFrontendEditorRuntime,
	) {
		this.element = this.createElement('div', 'bold-frontend');
		this.element.setAttribute('role', 'application');
		this.element.setAttribute('aria-label', 'Bold Code');

		const rail = this.createElement('nav', 'bold-frontend__rail');
		rail.setAttribute('aria-label', '主导航');
		const brand = this.createElement('div', 'bold-frontend__brand', 'B');
		brand.title = 'Bold Code';
		rail.append(brand);

		const railPrimary = this.createElement('div', 'bold-frontend__rail-group');
		const editButton = this.createButton({ className: 'is-active', icon: '▱', label: '文件', title: '工作区文件', onClick: () => void this.openEditMode() });
		editButton.dataset.mode = 'edit';
		this.searchButton = this.createButton({ icon: '⌕', label: '搜索', title: '全文本搜索', onClick: () => void this.toggleSearch() });
		this.searchButton.dataset.surface = 'search';
		this.terminalButton = this.createButton({ icon: '>_', label: '终端', title: '切换终端', onClick: () => void this.runAction('terminal') });
		this.terminalButton.dataset.surface = 'terminal';
		railPrimary.append(
			editButton,
			this.searchButton,
			this.terminalButton,
		);
		rail.append(railPrimary);

		const railAgents = this.createElement('div', 'bold-frontend__rail-group bold-frontend__rail-group--agents');
		const claudeButton = this.createButton({ icon: 'C', label: 'Claude', title: '打开 Claude Code', onClick: () => void this.switchMode('claudeAgent') });
		claudeButton.dataset.mode = 'claudeAgent';
		const codexButton = this.createButton({ icon: 'X', label: 'Codex', title: '打开 Codex', onClick: () => void this.switchMode('codexAgent') });
		codexButton.dataset.mode = 'codexAgent';
		railAgents.append(claudeButton, codexButton);
		rail.append(railAgents);

		const railBottom = this.createElement('div', 'bold-frontend__rail-group bold-frontend__rail-group--bottom');
		this.sshButton = this.createButton({ icon: '⇄', label: 'SSH', title: '通过 SSH 连接远程主机', onClick: () => void this.toggleSSHPanel() });
		this.sshButton.dataset.surface = 'ssh';
		railBottom.append(
			this.sshButton,
			this.createButton({ icon: '⚙', label: '设置', title: 'AI 与应用设置', onClick: () => void this.toggleSettings() }),
		);
		rail.append(railBottom);

		const explorer = this.createElement('aside', 'bold-frontend__explorer');
		const explorerHeader = this.createElement('header', 'bold-frontend__explorer-header');
		const explorerEyebrow = this.createElement('span', 'bold-frontend__eyebrow', 'WORKSPACE');
		this.workspaceTitle = this.createElement('strong', 'bold-frontend__workspace-title', '正在载入…');
		const explorerActions = this.createElement('div', 'bold-frontend__explorer-actions');
		explorerActions.append(
			this.createButton({ className: 'bold-frontend__mini-button', icon: '+', label: '新建文件', onClick: () => void this.runAction('newFile') }),
			this.createButton({ className: 'bold-frontend__mini-button', icon: '↻', label: '刷新', onClick: () => void this.refresh() }),
		);
		explorerHeader.append(explorerEyebrow, this.workspaceTitle, explorerActions);
		this.workspaceTree = this.createElement('div', 'bold-frontend__tree');
		this.workspaceTree.setAttribute('role', 'tree');
		this.searchPanel = this.createElement('section', 'bold-frontend__native-search');
		this.searchPanel.hidden = true;
		const searchForm = this.createElement('form', 'bold-frontend__native-search-form');
		this.searchInput = this.createElement('input', 'bold-frontend__native-search-input');
		this.searchInput.type = 'search';
		this.searchInput.placeholder = '搜索工作区';
		this.searchInput.autocomplete = 'off';
		this.searchInput.spellcheck = false;
		const searchSubmit = this.createElement('button', 'bold-frontend__native-search-submit', '⌕');
		searchSubmit.type = 'submit';
		searchSubmit.title = '搜索';
		searchForm.append(this.searchInput, searchSubmit);
		this.searchSummary = this.createElement('div', 'bold-frontend__native-search-summary', '输入关键词搜索当前工作区');
		this.searchResults = this.createElement('div', 'bold-frontend__native-search-results');
		this.searchPanel.append(searchForm, this.searchSummary, this.searchResults);
		this.sshPanel = this.createElement('section', 'bold-frontend__native-ssh');
		this.sshPanel.hidden = true;
		const sshForm = this.createElement('form', 'bold-frontend__native-ssh-form');
		this.sshInput = this.createElement('input', 'bold-frontend__native-ssh-input');
		this.sshInput.placeholder = 'user@hostname[:port] 或 Host 别名';
		this.sshInput.autocomplete = 'off';
		this.sshInput.spellcheck = false;
		const sshSubmit = this.createElement('button', 'bold-frontend__native-ssh-submit', '连接');
		sshSubmit.type = 'submit';
		sshForm.append(this.sshInput, sshSubmit);
		this.sshStatus = this.createElement('div', 'bold-frontend__native-ssh-status', '选择一个 SSH Host，或手动输入连接地址。');
		this.sshHosts = this.createElement('div', 'bold-frontend__native-ssh-hosts');
		const sshActions = this.createElement('div', 'bold-frontend__native-ssh-actions');
		const configureSSH = this.createElement('button', 'bold-frontend__native-ssh-secondary', '打开 SSH 配置');
		configureSSH.type = 'button';
		configureSSH.addEventListener('click', () => void this.bridge.openSSHConfig());
		sshActions.append(configureSSH);
		this.sshPanel.append(sshForm, this.sshStatus, this.sshHosts, sshActions);
		explorer.append(explorerHeader, this.workspaceTree, this.searchPanel, this.sshPanel);
		searchForm.addEventListener('submit', event => {
			event.preventDefault();
			void this.runNativeSearch();
		});
		this.searchInput.addEventListener('input', () => this.scheduleNativeSearch());
		sshForm.addEventListener('submit', event => {
			event.preventDefault();
			void this.connectSSHHost(this.sshInput.value);
		});

		const topbar = this.createElement('header', 'bold-frontend__topbar');
		this.tabs = this.createElement('div', 'bold-frontend__tabs');
		this.tabs.setAttribute('role', 'tablist');
		const topbarActions = this.createElement('div', 'bold-frontend__topbar-actions');
		topbarActions.append(
			this.createButton({ className: 'bold-frontend__search-button', icon: '⌕', label: '搜索工作区', onClick: () => void this.toggleSearch() }),
			this.createButton({ className: 'bold-frontend__topbar-button', icon: '+', label: '新文件', onClick: () => void this.runAction('newFile') }),
		);
		topbar.append(this.tabs, topbarActions);

		const statusbar = this.createElement('footer', 'bold-frontend__statusbar');
		this.connectionStatus = this.createElement('span', 'bold-frontend__status-item');
		this.providerStatus = this.createElement('span', 'bold-frontend__status-item bold-frontend__status-item--right');
		statusbar.append(this.connectionStatus, this.providerStatus);

		const content = this.createElement('main', 'bold-frontend__content');
		this.editorHost = this.createElement('div', 'bold-frontend__editor');
		this.emptyEditor = this.createElement('section', 'bold-frontend__editor-empty');
		this.emptyEditor.append(
			this.createElement('span', 'bold-frontend__editor-mark', 'B'),
			this.createElement('strong', undefined, 'Bold Code'),
			this.createElement('span', undefined, '从左侧工作区打开文件，或按 ⌘N 新建草稿'),
		);
		this.agentSurface = this.createElement('section', 'bold-frontend__agent-surface');
		const agentLoader = this.createElement('span', 'bold-frontend__agent-loader');
		agentLoader.setAttribute('aria-hidden', 'true');
		agentLoader.append(
			this.createElement('i'),
			this.createElement('i'),
			this.createElement('i'),
		);
		this.agentSurface.append(
			agentLoader,
		);
		this.agentTitle = this.createElement('strong', undefined, 'Bold Agent');
		this.agentDetail = this.createElement('span', undefined, '界面已就绪，正在加载 Agent 扩展 Web…');
		this.agentSurface.append(this.agentTitle, this.agentDetail);
		this.transitionOverlay = this.createElement('section', 'bold-frontend__transition');
		this.transitionOverlay.hidden = true;
		this.transitionOverlay.inert = true;
		this.transitionOverlay.setAttribute('aria-live', 'polite');
		const transitionSpinner = this.createElement('span', 'bold-frontend__transition-spinner');
		this.transitionTitle = this.createElement('strong', undefined, '正在切换工作区');
		this.transitionDetail = this.createElement('span', undefined, '正在准备内容视图…');
		this.transitionOverlay.append(transitionSpinner, this.transitionTitle, this.transitionDetail);
		content.append(this.editorHost, this.emptyEditor, this.agentSurface, this.transitionOverlay);

		this.settingsDrawer = this.createElement('aside', 'bold-frontend__settings');
		this.settingsDrawer.setAttribute('aria-hidden', 'true');
		this.settingsDrawer.inert = true;
		const settingsHeader = this.createElement('header', 'bold-frontend__settings-header');
		settingsHeader.append(
			this.createElement('strong', undefined, 'AI & Gateway Setting'),
			this.createButton({ className: 'bold-frontend__settings-close', icon: '×', label: '关闭设置', onClick: () => this.closeSettings() }),
		);
		this.settingsBody = this.createElement('div', 'bold-frontend__settings-body');
		this.settingsDrawer.append(settingsHeader, this.settingsBody);

		this.element.append(rail, explorer, topbar, content, statusbar, this.settingsDrawer);
		this.editorHost.hidden = true;
		this.emptyEditor.hidden = true;
		const handleEditorKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey) {
				return;
			}
			if (event.key.toLowerCase() === 's') {
				event.preventDefault();
				event.stopPropagation();
				void this.saveActiveDocument();
			} else if (event.key.toLowerCase() === 'n') {
				event.preventDefault();
				event.stopPropagation();
				this.createUntitledDocument();
			} else if (event.key.toLowerCase() === 'f') {
				event.preventDefault();
				event.stopPropagation();
				void this.editor?.getAction('actions.find')?.run();
			}
		};
		this.editorHost.addEventListener('keydown', handleEditorKeyDown, true);
		this.disposers.push(() => this.editorHost.removeEventListener('keydown', handleEditorKeyDown, true));
		this.disposers.push(this.bridge.subscribe(state => {
			void this.acceptState(state).catch(() => {
				this.connectionStatus.textContent = '界面状态暂时无法同步';
				this.connectionStatus.classList.add('is-error');
			});
		}));
	}

	async start(): Promise<void> {
		await this.refresh();
	}

	private async initializeEditor(): Promise<void> {
		if (this.editor) {
			return;
		}
		if (!this.editorInitialization) {
			this.editorInitialization = this.doInitializeEditor();
		}
		const initialization = this.editorInitialization;
		try {
			await initialization;
		} catch (error) {
			if (this.editorInitialization === initialization) {
				this.editorInitialization = undefined;
			}
			throw error;
		}
	}

	private async doInitializeEditor(): Promise<void> {
		// Reuse the already-running Workbench editor kernel. Loading the standalone
		// bundle into the same renderer would register a second service graph.
		this.editor = this.editorRuntime.createEditor(this.editorHost, {
			automaticLayout: false,
			fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
			fontSize: 13,
			hover: { enabled: 'off' },
			lineHeight: 21,
			minimap: { enabled: true },
			padding: { top: 16, bottom: 16 },
			renderLineHighlight: 'all',
			scrollBeyondLastLine: false,
			smoothScrolling: true,
		});
		const resizeObserver = new ResizeObserver(() => this.editor?.layout());
		resizeObserver.observe(this.editorHost);
		this.disposers.push(() => resizeObserver.disconnect(), () => this.editor?.dispose());
	}

	dispose(): void {
		for (const document of this.openDocuments.values()) {
			document.modelListener.dispose();
			document.model.dispose();
		}
		this.openDocuments.clear();
		while (this.disposers.length) {
			this.disposers.pop()?.();
		}
		this.element.remove();
	}

	private async refresh(): Promise<void> {
		try {
			this.workspaceSignature = '';
			await this.acceptState(await this.bridge.getState());
		} catch {
			this.workspaceTitle.textContent = '无法载入工作区';
			this.connectionStatus.textContent = '后端暂不可用';
			this.connectionStatus.classList.add('is-error');
		}
	}

	private async acceptState(state: IBoldFrontendState): Promise<void> {
		const request = ++this.stateApplication;
		this.applyState(state);
		if (state.mode === 'edit') {
			await this.initializeEditor();
		}
		if (request !== this.stateApplication) {
			return;
		}
		this.editor?.layout();
	}

	private applyState(state: IBoldFrontendState): void {
		this.state = state;
		this.element.hidden = false;
		this.element.classList.toggle('is-agent-mode', state.mode !== 'edit');
		if (state.searchActive || state.terminalActive || state.mode !== 'edit') {
			this.setSSHPanelActive(false, false);
		}
		for (const button of this.element.querySelectorAll<HTMLElement>('[data-mode]')) {
			const active = button.dataset.mode === state.mode && (state.mode !== 'edit' || (!state.searchActive && !state.terminalActive && !this.sshActive));
			button.classList.toggle('is-active', active);
			button.setAttribute('aria-pressed', String(active));
		}
		this.searchButton.classList.toggle('is-active', state.searchActive);
		this.searchButton.setAttribute('aria-pressed', String(state.searchActive));
		this.terminalButton.classList.toggle('is-active', state.terminalActive);
		this.terminalButton.setAttribute('aria-pressed', String(state.terminalActive));
		this.sshButton.classList.toggle('is-active', this.sshActive);
		this.sshButton.setAttribute('aria-pressed', String(this.sshActive));
		this.workspaceTree.hidden = state.searchActive || this.sshActive;
		this.searchPanel.hidden = !state.searchActive;
		this.sshPanel.hidden = !this.sshActive;
		if (state.searchActive) {
			this.document.defaultView?.requestAnimationFrame(() => this.searchInput.focus());
		} else if (this.sshActive) {
			this.document.defaultView?.requestAnimationFrame(() => this.sshInput.focus());
		}
		this.workspaceTitle.textContent = state.workspaceName;
		this.connectionStatus.textContent = state.gatewayStatus === 'authenticated'
			? `$${(state.gatewayBalance ?? 0).toFixed(2)} 剩余  ·  今日 $${(state.gatewayTodayUsage ?? 0).toFixed(2)}`
			: state.gatewayStatus === 'signedOut' ? 'Gateway 未登录' : 'Gateway 用量暂不可用';
		this.connectionStatus.classList.toggle('is-connected', state.gatewayStatus === 'authenticated');
		const editChatName = state.editChatProvider === 'claude' ? 'Claude' : 'Codex';
		this.providerStatus.textContent = state.mode === 'edit'
			? `右侧对话 · ${editChatName}`
			: `Claude ${state.claudeEnabled ? '已启用' : '未启用'}  ·  Codex ${state.codexEnabled ? '已启用' : '未启用'}`;
		this.renderAgentSurface(state);
		this.renderDocumentTabs();

		const workspaceSignature = state.workspaceRoots.map(root => `${root.name}:${root.uri}`).join('|');
		if (workspaceSignature !== this.workspaceSignature) {
			this.workspaceSignature = workspaceSignature;
			this.renderWorkspaceRoots(state.workspaceRoots);
		}
	}

	private renderTabs(tabs: readonly IBoldFrontendTab[]): void {
		this.tabs.replaceChildren();
		if (!tabs.length) {
			const emptyLabel = this.state?.mode === 'claudeAgent'
				? 'Claude Code · 扩展渲染'
				: this.state?.mode === 'codexAgent'
					? 'Codex · 扩展渲染'
					: '打开一个文件开始编辑';
			const empty = this.createElement('div', 'bold-frontend__empty-tab', emptyLabel);
			this.tabs.append(empty);
			return;
		}

		for (const tab of tabs) {
			const tabElement = this.createElement('div', `bold-frontend__tab${tab.active ? ' is-active' : ''}`);
			tabElement.setAttribute('role', 'tab');
			tabElement.setAttribute('aria-selected', String(tab.active));
			const activate = this.createElement('button', 'bold-frontend__tab-label', `${tab.dirty ? '● ' : ''}${tab.label}`);
			activate.type = 'button';
			activate.addEventListener('click', () => this.activateDocument(tab.id));
			const close = this.createElement('button', 'bold-frontend__tab-close', '×');
			close.type = 'button';
			close.title = `关闭 ${tab.label}`;
			close.addEventListener('click', event => {
				event.stopPropagation();
				this.closeDocument(tab.id);
			});
			tabElement.append(activate, close);
			this.tabs.append(tabElement);
		}
	}

	private renderDocumentTabs(): void {
		const tabs: IBoldFrontendTab[] = Array.from(this.openDocuments.values()).map(document => ({
			id: document.id,
			label: document.name,
			active: document.id === this.activeDocumentId,
			dirty: document.model.getAlternativeVersionId() !== document.savedAlternativeVersionId,
		}));
		this.renderTabs(tabs);
	}

	private renderAgentSurface(state: IBoldFrontendState): void {
		const agentMode = state.mode !== 'edit';
		this.agentSurface.hidden = !agentMode;
		if (!agentMode) {
			this.editorHost.hidden = !this.activeDocumentId;
			this.emptyEditor.hidden = !!this.activeDocumentId;
			return;
		}
		this.editorHost.hidden = true;
		this.emptyEditor.hidden = true;
		const agentName = state.mode === 'claudeAgent' ? 'Claude Code' : 'Codex';
		const enabled = state.mode === 'claudeAgent' ? state.claudeEnabled : state.codexEnabled;
		this.agentTitle.textContent = `正在加载 ${agentName}`;
		this.agentDetail.textContent = enabled
			? 'Bold 界面已就绪，正在等待扩展 Web 加载完成…'
			: `${agentName} 当前未启用，请先在设置中配置。`;
	}

	private renderWorkspaceRoots(roots: readonly IBoldFrontendFileEntry[]): void {
		this.workspaceTree.replaceChildren();
		this.expandedFolders.clear();
		if (!roots.length) {
			const empty = this.createElement('div', 'bold-frontend__empty-state');
			empty.append(
				this.createElement('strong', undefined, '尚未打开文件夹'),
				this.createElement('span', undefined, '打开文件夹后，这里会显示 Bold 自绘的工作区树。'),
				this.createButton({ className: 'bold-frontend__empty-action', icon: '+', label: '新建草稿', onClick: () => this.createUntitledDocument() }),
			);
			this.workspaceTree.append(empty);
			return;
		}

		for (const root of roots) {
			const branch = this.createTreeEntry(root, 0, true);
			this.workspaceTree.append(branch);
			void this.expandFolder(root, branch, 0);
		}
	}

	private createTreeEntry(entry: IBoldFrontendFileEntry, depth: number, root = false): HTMLElement {
		const branch = this.createElement('div', `bold-frontend__tree-branch${root ? ' is-root' : ''}`);
		const row = this.createElement('button', 'bold-frontend__tree-row');
		row.type = 'button';
		row.style.setProperty('--tree-depth', String(depth));
		row.setAttribute('role', 'treeitem');
		row.setAttribute('aria-label', entry.name);
		const chevron = this.createElement('span', 'bold-frontend__tree-chevron', entry.directory ? '›' : '');
		const icon = this.createElement('span', `bold-frontend__file-icon${entry.directory ? ' is-folder' : ''}`, entry.directory ? '◆' : '•');
		const name = this.createElement('span', 'bold-frontend__tree-name', entry.name);
		row.append(chevron, icon, name);
		const children = this.createElement('div', 'bold-frontend__tree-children');
		children.setAttribute('role', 'group');

		row.addEventListener('click', () => {
			if (entry.directory) {
				if (this.expandedFolders.has(entry.uri)) {
					this.expandedFolders.delete(entry.uri);
					branch.classList.remove('is-expanded');
					children.replaceChildren();
				} else {
					void this.expandFolder(entry, branch, depth);
				}
			} else {
				void this.openDocument(entry.uri);
			}
		});

		branch.append(row, children);
		return branch;
	}

	private async expandFolder(entry: IBoldFrontendFileEntry, branch: HTMLElement, depth: number): Promise<void> {
		if (this.expandedFolders.has(entry.uri)) {
			return;
		}
		this.expandedFolders.add(entry.uri);
		branch.classList.add('is-expanded', 'is-loading');
		const childrenContainer = branch.querySelector<HTMLElement>(':scope > .bold-frontend__tree-children');
		try {
			const children = await this.bridge.listDirectory(entry.uri);
			childrenContainer?.replaceChildren(...children.map(child => this.createTreeEntry(child, depth + 1)));
		} catch {
			childrenContainer?.replaceChildren(this.createElement('div', 'bold-frontend__tree-error', '无法读取此目录'));
		} finally {
			branch.classList.remove('is-loading');
		}
	}

	private focusExplorer(): void {
		this.workspaceTree.querySelector<HTMLElement>('.bold-frontend__tree-row')?.focus();
	}

	private async openEditMode(): Promise<void> {
		if (this.state?.mode !== 'edit' || this.state.searchActive || this.state.terminalActive || this.sshActive) {
			this.setSSHPanelActive(false, false);
			this.showModeTransition('edit');
			try {
				await this.bridge.setMode('edit');
				await this.acceptState(await this.bridge.getState());
			} finally {
				this.hideModeTransition();
			}
			return;
		}
		this.focusExplorer();
	}

	private async toggleSearch(): Promise<void> {
		this.setSSHPanelActive(false, false);
		await this.bridge.toggleSearch();
		await this.acceptState(await this.bridge.getState());
	}

	private async toggleSSHPanel(): Promise<void> {
		const next = !this.sshActive;
		if (next) {
			if (this.state?.mode !== 'edit' || this.state.searchActive || this.state.terminalActive) {
				await this.bridge.setMode('edit');
				await this.acceptState(await this.bridge.getState());
			}
			this.setSSHPanelActive(true, true);
			await this.loadSSHHosts();
		} else {
			this.setSSHPanelActive(false, true);
		}
	}

	private setSSHPanelActive(active: boolean, focus: boolean): void {
		this.sshActive = active;
		this.workspaceTree.hidden = active || this.state?.searchActive === true;
		this.sshPanel.hidden = !active;
		this.sshButton.classList.toggle('is-active', active);
		this.sshButton.setAttribute('aria-pressed', String(active));
		if (active && focus) {
			this.document.defaultView?.requestAnimationFrame(() => this.sshInput.focus());
		}
	}

	private async loadSSHHosts(): Promise<void> {
		this.sshStatus.textContent = '正在读取 ~/.ssh/config...';
		try {
			const hosts = await this.bridge.listSSHHosts();
			this.renderSSHHosts(hosts);
			this.sshStatus.textContent = hosts.length ? `${hosts.length} 个可用 Host` : '没有发现 SSH Host，可以手动输入。';
		} catch {
			this.sshHosts.replaceChildren();
			this.sshStatus.textContent = '读取 SSH 配置失败，可以手动输入。';
		}
	}

	private renderSSHHosts(hosts: readonly IBoldFrontendSSHHost[]): void {
		this.sshHosts.replaceChildren();
		for (const host of hosts) {
			const button = this.createElement('button', 'bold-frontend__native-ssh-host');
			button.type = 'button';
			button.append(
				this.createElement('strong', undefined, host.alias),
				this.createElement('span', undefined, host.detail ?? host.destination ?? '使用 SSH 配置连接'),
			);
			button.addEventListener('click', () => {
				this.sshInput.value = host.alias;
				void this.connectSSHHost(host.alias);
			});
			this.sshHosts.append(button);
		}
	}

	private async connectSSHHost(host: string): Promise<void> {
		const target = host.trim();
		if (!target) {
			this.sshStatus.textContent = '请输入 SSH Host。';
			return;
		}
		this.sshPanel.classList.add('is-connecting');
		this.sshStatus.textContent = `正在连接 ${target}...`;
		try {
			await this.bridge.connectSSHHost(target);
			this.document.defaultView?.setTimeout(() => {
				if (this.sshActive) {
					this.sshPanel.classList.remove('is-connecting');
					this.sshStatus.textContent = `仍在等待 ${target} 响应；如果连接失败，请检查主机名、端口和密钥。`;
				}
			}, 12000);
		} catch {
			this.sshPanel.classList.remove('is-connecting');
			this.sshStatus.textContent = `无法连接 ${target}。请检查 SSH 配置。`;
		}
	}

	private scheduleNativeSearch(): void {
		if (this.searchTimer !== undefined) {
			this.document.defaultView?.clearTimeout(this.searchTimer);
		}
		this.searchTimer = this.document.defaultView?.setTimeout(() => {
			this.searchTimer = undefined;
			void this.runNativeSearch();
		}, 160);
	}

	private async runNativeSearch(): Promise<void> {
		const query = this.searchInput.value.trim();
		const request = ++this.searchRequest;
		if (!query) {
			this.searchSummary.textContent = '输入关键词搜索当前工作区';
			this.searchResults.replaceChildren();
			return;
		}
		this.searchSummary.textContent = '正在搜索...';
		try {
			const results = await this.bridge.searchWorkspace(query);
			if (request !== this.searchRequest) {
				return;
			}
			this.renderNativeSearchResults(query, results);
		} catch {
			if (request === this.searchRequest) {
				this.searchSummary.textContent = '搜索失败';
				this.searchResults.replaceChildren();
			}
		}
	}

	private renderNativeSearchResults(query: string, results: readonly IBoldFrontendSearchResult[]): void {
		const matchCount = results.reduce((count, result) => count + result.matches.length, 0);
		this.searchSummary.textContent = results.length
			? `${results.length} 个文件 · ${matchCount} 处匹配`
			: `没有找到 “${query}”`;
		this.searchResults.replaceChildren();
		for (const result of results) {
			const item = this.createElement('article', 'bold-frontend__native-search-result');
			const button = this.createElement('button', 'bold-frontend__native-search-file');
			button.type = 'button';
			button.append(
				this.createElement('strong', undefined, result.name),
				this.createElement('span', undefined, result.path),
			);
			button.addEventListener('click', () => void this.openDocument(result.uri));
			item.append(button);
			for (const match of result.matches) {
				const line = this.createElement('button', 'bold-frontend__native-search-match');
				line.type = 'button';
				line.append(
					this.createElement('span', 'bold-frontend__native-search-line', String(match.line)),
					this.createElement('span', 'bold-frontend__native-search-preview', match.preview),
				);
				line.addEventListener('click', () => void this.openDocument(result.uri));
				item.append(line);
			}
			this.searchResults.append(item);
		}
	}

	private async runAction(action: BoldFrontendAction): Promise<void> {
		if (action === 'newFile') {
			this.createUntitledDocument();
			return;
		}
		this.setSSHPanelActive(false, false);
		await this.bridge.runAction(action);
		await this.acceptState(await this.bridge.getState());
	}

	private async openDocument(uri: string): Promise<void> {
		if (!this.editor) {
			return;
		}
		const existing = this.openDocuments.get(uri);
		if (existing) {
			this.activateDocument(uri);
			return;
		}

		const document = await this.bridge.openFile(uri);
		const model = this.editorRuntime.createModel(document.contents, document.languageId, URI.parse(document.uri));
		const openDocument: IOpenDocument = {
			id: document.uri,
			name: document.name,
			model,
			modelListener: model.onDidChangeContent(() => this.renderDocumentTabs()),
			savedAlternativeVersionId: model.getAlternativeVersionId(),
		};
		this.openDocuments.set(document.uri, openDocument);
		this.activateDocument(document.uri);
	}

	private createUntitledDocument(): void {
		if (!this.editor) {
			return;
		}
		const number = ++this.untitledCounter;
		const id = `untitled://bold/Untitled-${number}`;
		const model = this.editorRuntime.createModel('', 'plaintext', URI.parse(id));
		const document: IOpenDocument = {
			id,
			name: `Untitled-${number}`,
			model,
			modelListener: model.onDidChangeContent(() => this.renderDocumentTabs()),
			savedAlternativeVersionId: model.getAlternativeVersionId(),
		};
		this.openDocuments.set(id, document);
		this.activateDocument(id);
	}

	private activateDocument(id: string): void {
		const document = this.openDocuments.get(id);
		if (!document || !this.editor) {
			return;
		}
		this.activeDocumentId = id;
		this.editor.setModel(document.model);
		this.emptyEditor.hidden = true;
		this.editorHost.hidden = false;
		this.editor.layout();
		this.editor.focus();
		this.renderDocumentTabs();
	}

	private closeDocument(id: string): void {
		const document = this.openDocuments.get(id);
		if (!document) {
			return;
		}
		const wasActive = this.activeDocumentId === id;
		document.modelListener.dispose();
		document.model.dispose();
		this.openDocuments.delete(id);
		if (wasActive) {
			const next = Array.from(this.openDocuments.keys()).at(-1);
			if (next) {
				this.activateDocument(next);
			} else {
				this.activeDocumentId = undefined;
				this.editor?.setModel(null);
				this.editorHost.hidden = true;
				this.emptyEditor.hidden = false;
			}
		}
		this.renderDocumentTabs();
	}

	private async saveActiveDocument(): Promise<void> {
		const document = this.activeDocumentId ? this.openDocuments.get(this.activeDocumentId) : undefined;
		if (!document || document.id.startsWith('untitled:')) {
			return;
		}
		await this.bridge.saveFile(document.id, document.model.getValue());
		document.savedAlternativeVersionId = document.model.getAlternativeVersionId();
		this.renderDocumentTabs();
	}

	async openGateway(): Promise<void> {
		await this.bridge.openGateway();
	}

	async toggleSettings(): Promise<void> {
		if (this.settingsDrawer.classList.contains('is-open')) {
			this.closeSettings();
			return;
		}
		this.settingsReturnFocus = this.document.activeElement instanceof HTMLElement ? this.document.activeElement : undefined;
		this.settingsDrawer.classList.add('is-open');
		this.settingsDrawer.setAttribute('aria-hidden', 'false');
		this.settingsDrawer.inert = false;
		this.settingsBody.replaceChildren(this.createElement('div', 'bold-frontend__settings-loading', '正在读取 AI 配置…'));
		try {
			this.renderSettings(await this.bridge.getAiSettings());
		} catch {
			this.settingsBody.replaceChildren(this.createElement('div', 'bold-frontend__settings-error', '无法读取 AI 配置'));
		}
	}

	private closeSettings(): void {
		this.settingsDrawer.inert = true;
		this.settingsReturnFocus?.focus();
		this.settingsReturnFocus = undefined;
		this.settingsDrawer.classList.remove('is-open');
		this.settingsDrawer.setAttribute('aria-hidden', 'true');
	}

	private renderSettings(settings: Awaited<ReturnType<IBoldFrontendBridge['getAiSettings']>>): void {
		this.settingsBody.replaceChildren();
		const intro = this.createElement('section', 'bold-frontend__settings-intro');
		intro.append(
			this.createElement('span', 'bold-frontend__eyebrow', 'AI WORKSPACE'),
			this.createElement('h2', undefined, '账号、用量与 API'),
			this.createElement('p', undefined, '在一处管理 Gateway 账号、API 分组，以及 Claude Code 与 Codex 各自使用的 API。'),
		);
		this.settingsBody.append(intro);
		this.settingsBody.append(
			this.createGatewayAccountSettings(settings),
			this.createGatewayGroupSettings(settings),
			this.createEditChatProviderSettings(settings.editChatProvider),
			this.createProviderSettings('claude', 'Claude Code', 'CL', settings),
			this.createProviderSettings('codex', 'Codex', 'CX', settings),
		);
	}

	private createGatewayAccountSettings(settings: Awaited<ReturnType<IBoldFrontendBridge['getAiSettings']>>): HTMLElement {
		const gateway = settings.gateway;
		const section = this.createElement('section', 'bold-frontend__gateway-account');
		const header = this.createElement('header', 'bold-frontend__gateway-account-header');
		const identity = this.createElement('div', 'bold-frontend__gateway-identity');
		identity.append(
			this.createElement('span', 'bold-frontend__provider-mark', 'AI'),
			this.createElement('div'),
		);
		identity.lastElementChild?.append(
			this.createElement('strong', undefined, gateway.status === 'authenticated' ? (gateway.accountLabel ?? 'AI Gateway 账号') : 'AI Gateway'),
			this.createElement('span', undefined, gateway.status === 'authenticated' ? (gateway.email ?? '已登录') : gateway.status === 'signedOut' ? '尚未登录' : (gateway.message ?? '暂时无法连接')),
		);
		header.append(identity);

		const actions = this.createElement('div', 'bold-frontend__gateway-account-actions');
		const refresh = this.createElement('button', 'is-secondary', '刷新');
		refresh.type = 'button';
		refresh.title = '刷新账号和用量';
		refresh.addEventListener('click', () => void this.reloadSettings());
		actions.append(refresh);
		if (gateway.status === 'authenticated') {
			const logout = this.createElement('button', 'is-danger', '退出登录');
			logout.type = 'button';
			logout.addEventListener('click', () => {
				logout.disabled = true;
				void this.bridge.logoutGateway().then(() => this.reloadSettings(), () => {
					logout.disabled = false;
				});
			});
			actions.append(logout);
		} else {
			const login = this.createElement('button', undefined, '登录');
			login.type = 'button';
			login.addEventListener('click', () => void this.openGateway());
			actions.append(login);
		}
		header.append(actions);
		section.append(header);

		if (gateway.status === 'authenticated') {
			const metrics = this.createElement('div', 'bold-frontend__gateway-metrics');
			for (const [label, value] of [
				['账户剩余', `$${(gateway.balance ?? 0).toFixed(2)}`],
				['今日用量', `$${(gateway.todayUsage ?? 0).toFixed(2)}`],
				['可用 API', String(gateway.apiKeys.length)],
			] as const) {
				const metric = this.createElement('div');
				metric.append(this.createElement('span', undefined, label), this.createElement('strong', undefined, value));
				metrics.append(metric);
			}
			section.append(metrics);
		}
		return section;
	}

	private createGatewayGroupSettings(settings: Awaited<ReturnType<IBoldFrontendBridge['getAiSettings']>>): HTMLElement {
		const section = this.createElement('section', 'bold-frontend__gateway-groups');
		const heading = this.createElement('header');
		const headingCopy = this.createElement('div');
		headingCopy.append(
			this.createElement('strong', undefined, 'API 分组管理'),
			this.createElement('span', undefined, '修改 API 所属平台与路由分组。'),
		);
		heading.append(headingCopy);
		if (settings.gateway.status === 'authenticated') {
			const createApi = this.createElement('button', 'bold-frontend__gateway-create-api', '+ 新建 API');
			createApi.type = 'button';
			createApi.addEventListener('click', () => void this.bridge.openGatewayApiCreation());
			heading.append(createApi);
		}
		section.append(heading);
		if (settings.gateway.status !== 'authenticated' || !settings.gateway.apiKeys.length) {
			section.append(this.createElement('p', 'bold-frontend__settings-muted', settings.gateway.status === 'authenticated' ? '当前账号没有可用 API。' : '登录后可调整 API 分组。'));
			return section;
		}

		const form = this.createElement('form', 'bold-frontend__gateway-group-form');
		const apiSelect = this.createSelect('选择 API');
		for (const api of settings.gateway.apiKeys) {
			apiSelect.add(new Option(`${api.name} · ${api.maskedKey}`, String(api.id)));
		}
		const groupSelect = this.createSelect('选择分组');
		for (const group of settings.gateway.groups) {
			groupSelect.add(new Option(`${group.name} · ${this.platformLabel(group.platform)}`, String(group.id)));
		}
		const syncGroup = () => {
			const api = settings.gateway.apiKeys.find(candidate => candidate.id === Number(apiSelect.value));
			groupSelect.value = api?.groupId == null ? '' : String(api.groupId);
		};
		apiSelect.addEventListener('change', syncGroup);
		syncGroup();
		const footer = this.createElement('div', 'bold-frontend__provider-actions');
		const status = this.createElement('span', 'bold-frontend__provider-status');
		const save = this.createElement('button', 'bold-frontend__provider-save', '更新分组');
		save.type = 'submit';
		footer.append(status, save);
		const apiField = this.createElement('div', 'bold-frontend__gateway-group-field');
		apiField.append(this.createElement('label', undefined, 'API'), apiSelect);
		const groupField = this.createElement('div', 'bold-frontend__gateway-group-field');
		groupField.append(this.createElement('label', undefined, '分组'), groupSelect);
		form.append(apiField, groupField, footer);
		form.addEventListener('submit', event => {
			event.preventDefault();
			const apiKeyId = Number(apiSelect.value);
			const groupId = Number(groupSelect.value);
			if (!Number.isFinite(apiKeyId) || apiKeyId <= 0 || !Number.isFinite(groupId) || groupId <= 0) {
				status.textContent = '请选择 API 和分组';
				return;
			}
			save.disabled = true;
			status.textContent = '正在更新...';
			void this.bridge.updateGatewayApiGroup(apiKeyId, groupId).then(() => this.reloadSettings(), () => {
				status.textContent = '更新失败';
				save.disabled = false;
			});
		});
		section.append(form);
		return section;
	}

	private createEditChatProviderSettings(selectedProvider: BoldFrontendProvider): HTMLElement {
		const card = this.createElement('section', 'bold-frontend__chat-preference');
		const copy = this.createElement('div', 'bold-frontend__chat-preference-copy');
		copy.append(
			this.createElement('strong', undefined, '编辑器右侧对话'),
			this.createElement('span', undefined, '编辑文件时常驻所选扩展；切换后立即刷新，无需重载窗口。'),
		);
		const choices = this.createElement('div', 'bold-frontend__chat-provider-choices');
		choices.setAttribute('role', 'radiogroup');
		choices.setAttribute('aria-label', '编辑器右侧对话扩展');
		const status = this.createElement('span', 'bold-frontend__chat-provider-status');

		const buttons: HTMLButtonElement[] = [];
		for (const [provider, label, mark] of [
			['claude', 'Claude', 'CL'],
			['codex', 'Codex', 'CX'],
		] as const) {
			const button = this.createElement('button', `bold-frontend__chat-provider-choice${provider === selectedProvider ? ' is-selected' : ''}`);
			button.type = 'button';
			button.setAttribute('role', 'radio');
			button.setAttribute('aria-checked', String(provider === selectedProvider));
			button.append(
				this.createElement('span', 'bold-frontend__chat-provider-mark', mark),
				this.createElement('span', undefined, label),
			);
			button.addEventListener('click', () => {
				if (button.classList.contains('is-selected')) {
					return;
				}
				for (const choice of buttons) {
					choice.disabled = true;
				}
				status.textContent = `正在切换到 ${label}…`;
				void this.bridge.setEditChatProvider(provider).then(() => {
					for (const choice of buttons) {
						const selected = choice === button;
						choice.classList.toggle('is-selected', selected);
						choice.setAttribute('aria-checked', String(selected));
					}
					status.textContent = `编辑器右侧已切换为 ${label}`;
				}, () => {
					status.textContent = '切换失败，已保留原扩展';
				}).finally(() => {
					for (const choice of buttons) {
						choice.disabled = false;
					}
				});
			});
			buttons.push(button);
			choices.append(button);
		}

		card.append(copy, choices, status);
		return card;
	}

	private createProviderSettings(provider: 'claude' | 'codex', title: string, mark: string, settings: Awaited<ReturnType<IBoldFrontendBridge['getAiSettings']>>): HTMLElement {
		const baseUrlValue = provider === 'claude' ? settings.claudeBaseUrl : settings.codexBaseUrl;
		const hasApiKey = provider === 'claude' ? settings.claudeHasApiKey : settings.codexHasApiKey;
		const selectedApiKeyId = provider === 'claude' ? settings.claudeGatewayApiKeyId : settings.codexGatewayApiKeyId;
		const card = this.createElement('section', 'bold-frontend__provider-card');
		const header = this.createElement('header', 'bold-frontend__provider-header');
		const update = this.createElement('button', 'bold-frontend__provider-update');
		update.type = 'button';
		update.title = `检查 ${title} 扩展更新`;
		update.setAttribute('aria-live', 'polite');
		const updateIcon = this.createElement('span', 'bold-frontend__provider-update-icon', '↻');
		const updateLabel = this.createElement('span', 'bold-frontend__provider-update-label', '检查更新');
		update.append(updateIcon, updateLabel);
		update.addEventListener('click', () => {
			update.disabled = true;
			update.dataset.state = 'checking';
			updateLabel.textContent = '正在检查';
			void this.bridge.checkForExtensionUpdate(provider).then(updated => {
				update.dataset.state = updated ? 'updated' : 'current';
				updateIcon.textContent = '✓';
				updateLabel.textContent = updated ? '已更新 · 重启生效' : '已是最新';
			}, () => {
				update.dataset.state = 'failed';
				updateIcon.textContent = '!';
				updateLabel.textContent = '检查失败';
			}).finally(() => {
				update.disabled = false;
			});
		});
		header.append(
			this.createElement('span', 'bold-frontend__provider-mark', mark),
			this.createElement('strong', undefined, title),
			hasApiKey ? this.createElement('span', 'bold-frontend__provider-connected', '已连接') : this.createElement('span', 'bold-frontend__provider-spacer'),
			update,
		);
		const gatewayForm = this.createElement('form', 'bold-frontend__provider-form');
		const apiLabel = this.createElement('label', undefined, 'Gateway API');
		const apiSelect = this.createSelect('选择 Gateway API');
		const compatibleApis = settings.gateway.apiKeys.filter(api => this.isApiCompatible(provider, api.platform, api.allowMessagesDispatch));
		for (const api of compatibleApis) {
			apiSelect.add(new Option(`${api.name} · ${api.groupName ?? this.platformLabel(api.platform)} · ${api.maskedKey}`, String(api.id)));
		}
		if (selectedApiKeyId && compatibleApis.some(api => api.id === selectedApiKeyId)) {
			apiSelect.value = String(selectedApiKeyId);
		}
		apiSelect.disabled = settings.gateway.status !== 'authenticated' || compatibleApis.length === 0;
		const gatewayFooter = this.createElement('div', 'bold-frontend__provider-actions');
		const gatewayStatus = this.createElement('span', 'bold-frontend__provider-status');
		gatewayStatus.textContent = settings.gateway.status !== 'authenticated'
			? '请先登录 Gateway'
			: compatibleApis.length ? `${compatibleApis.length} 个兼容 API` : '没有兼容 API，请先调整分组';
		const apply = this.createElement('button', 'bold-frontend__provider-save', '应用 API');
		apply.type = 'submit';
		apply.disabled = apiSelect.disabled;
		gatewayFooter.append(gatewayStatus, apply);
		gatewayForm.append(apiLabel, apiSelect, gatewayFooter);
		gatewayForm.addEventListener('submit', event => {
			event.preventDefault();
			const apiKeyId = Number(apiSelect.value);
			if (!Number.isFinite(apiKeyId) || apiKeyId <= 0) {
				gatewayStatus.textContent = '请选择 API';
				return;
			}
			apply.disabled = true;
			gatewayStatus.textContent = '正在应用...';
			void this.bridge.selectGatewayApi(provider, apiKeyId).then(() => this.reloadSettings(), () => {
				gatewayStatus.textContent = '应用失败';
				apply.disabled = false;
			});
		});

		const manual = this.createElement('details', 'bold-frontend__manual-config');
		manual.append(this.createElement('summary', undefined, '手动配置 Base URL 与 API Key'));
		const form = this.createElement('form', 'bold-frontend__provider-form');
		const baseUrlLabel = this.createElement('label', undefined, 'Base URL');
		const baseUrl = this.createElement('input');
		baseUrl.type = 'url';
		baseUrl.value = baseUrlValue;
		baseUrl.placeholder = 'https://…/v1';
		const apiKeyLabel = this.createElement('label', undefined, hasApiKey ? 'API Key · 已配置，留空保持不变' : 'API Key');
		const apiKey = this.createElement('input');
		apiKey.type = 'password';
		apiKey.autocomplete = 'off';
		apiKey.placeholder = hasApiKey ? '••••••••' : 'sk-…';
		const footer = this.createElement('div', 'bold-frontend__provider-actions');
		const status = this.createElement('span', 'bold-frontend__provider-status');
		const submit = this.createElement('button', 'bold-frontend__provider-save', '保存配置');
		submit.type = 'submit';
		footer.append(status, submit);
		form.append(baseUrlLabel, baseUrl, apiKeyLabel, apiKey, footer);
		form.addEventListener('submit', event => {
			event.preventDefault();
			submit.disabled = true;
			status.textContent = '正在保存…';
			void this.bridge.saveAiSettings(provider, baseUrl.value.trim(), apiKey.value).then(() => {
				status.textContent = '已保存';
				apiKey.value = '';
			}, () => {
				status.textContent = '保存失败';
			}).finally(() => submit.disabled = false);
		});
		manual.append(form);
		card.append(header, gatewayForm, manual);
		return card;
	}

	private createSelect(placeholder: string): HTMLSelectElement {
		const select = this.createElement('select');
		select.add(new Option(placeholder, ''));
		return select;
	}

	private isApiCompatible(provider: BoldFrontendProvider, platform: string | undefined, allowMessagesDispatch: boolean): boolean {
		const resolvedPlatform = platform ?? 'anthropic';
		return provider === 'codex'
			? resolvedPlatform === 'openai'
			: resolvedPlatform === 'anthropic' || resolvedPlatform === 'antigravity' || (resolvedPlatform === 'openai' && allowMessagesDispatch);
	}

	private platformLabel(platform: string | undefined): string {
		switch (platform) {
			case 'anthropic': return 'Claude';
			case 'openai': return 'OpenAI';
			case 'antigravity': return 'Antigravity';
			case 'gemini': return 'Gemini';
			default: return '未分组';
		}
	}

	private async reloadSettings(): Promise<void> {
		this.settingsBody.replaceChildren(this.createElement('div', 'bold-frontend__settings-loading', '正在刷新账号与 API...'));
		try {
			this.renderSettings(await this.bridge.getAiSettings());
			await this.acceptState(await this.bridge.getState());
		} catch {
			this.settingsBody.replaceChildren(this.createElement('div', 'bold-frontend__settings-error', '无法刷新账号与 API'));
		}
	}

	private async switchMode(mode: BoldFrontendMode): Promise<void> {
		if (!this.switchingMode && this.state?.mode === mode && !this.state.searchActive && !this.state.terminalActive && !this.sshActive) {
			return;
		}

		this.setSSHPanelActive(false, false);
		this.pendingMode = mode;
		if (this.switchingMode) {
			return;
		}
		this.switchingMode = true;
		try {
			while (this.pendingMode) {
				const targetMode = this.pendingMode;
				this.pendingMode = undefined;
				if (this.state?.mode === targetMode && !this.state.searchActive && !this.state.terminalActive && !this.sshActive) {
					continue;
				}

				this.showModeTransition(targetMode);
				try {
					await this.bridge.setMode(targetMode);
					await this.acceptState(await this.bridge.getState());
					await new Promise<void>(resolve => this.document.defaultView?.requestAnimationFrame(() => resolve()) ?? resolve());
				} catch {
					try {
						await this.acceptState(await this.bridge.getState());
					} catch {
						// Keep the last rendered state while displaying the transition error.
					}
					this.transitionTitle.textContent = '无法切换模式';
					this.transitionDetail.textContent = '扩展视图暂时不可用，请稍后重试。';
					await new Promise<void>(resolve => this.document.defaultView?.setTimeout(resolve, 1200) ?? resolve());
				}
			}
		} finally {
			this.hideModeTransition();
			this.switchingMode = false;
		}
	}

	private showModeTransition(mode: BoldFrontendMode): void {
		const target = mode === 'claudeAgent' ? 'Claude Code' : mode === 'codexAgent' ? 'Codex' : '编辑器';
		this.transitionTitle.textContent = `正在切换到 ${target}`;
		this.transitionDetail.textContent = mode === 'edit' ? '正在恢复文件与编辑状态…' : '正在连接扩展渲染视图…';
		this.transitionOverlay.hidden = false;
		this.transitionOverlay.inert = false;
		this.element.classList.add('is-transitioning');
	}

	private hideModeTransition(): void {
		this.element.classList.remove('is-transitioning');
		this.transitionOverlay.hidden = true;
		this.transitionOverlay.inert = true;
	}

	private createButton(options: IButtonOptions): HTMLButtonElement {
		const button = this.createElement('button', `bold-frontend__button${options.className ? ` ${options.className}` : ''}`);
		button.type = 'button';
		button.title = options.title ?? options.label;
		button.setAttribute('aria-label', options.label);
		const icon = this.createElement('span', 'bold-frontend__button-icon', options.icon);
		const label = this.createElement('span', 'bold-frontend__button-label', options.label);
		button.append(icon, label);
		button.addEventListener('click', options.onClick);
		return button;
	}

	private createElement<K extends keyof HTMLElementTagNameMap>(tagName: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
		const element = this.document.createElement(tagName);
		if (className) {
			element.className = className;
		}
		if (text !== undefined) {
			element.append(this.document.createTextNode(text));
		}
		return element;
	}
}
