/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, timeout } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { AI_HUB_AGENT_LOADING_CLASS, AI_HUB_AGENT_MODE_CLASS, AI_HUB_EDIT_CHAT_MODE_CLASS, AiHubMode, AiHubProvider, BOLD_FRONTEND_ACTIVE_CLASS, CLAUDE_EXTENSION_ID, CODEX_EXTENSION_ID, IAiConfigService, IAiHubModeController } from './aiHubTypes.js';

const CLAUDE_AGENT_CONTAINER_IDS = ['claude-sidebar-secondary', 'claude-sidebar'];
const CODEX_AGENT_CONTAINER_IDS = ['codexSecondaryViewContainer', 'codexViewContainer'];
const CLAUDE_AGENT_VIEW_IDS = ['claudeVSCodeSidebarSecondary', 'claudeVSCodeSidebar'];
const CODEX_AGENT_VIEW_IDS = ['chatgpt.sidebarSecondaryView', 'chatgpt.sidebarView'];
const AGENT_SURFACE_RETRY_COUNT = 50;
const AGENT_SURFACE_RETRY_DELAY = 100;
const ACTIVE_AGENT_WEBVIEW_PORTAL_CLASS = 'bold-agent-webview-portal';

type AiHubAgentMode = Exclude<AiHubMode, 'edit'>;

/**
 * Keeps Claude/Codex extensions as the implementation, while moving their
 * extension-owned webview into the Bold shell. VS Code workbench parts are only
 * used as an invisible factory for extension webviews.
 */
export class AiHubModeController extends Disposable implements IAiHubModeController {

	declare readonly _serviceBrand: undefined;

	private currentMode: AiHubMode = 'edit';
	private editChatProvider: AiHubProvider = 'claude';
	private surfaceGeneration = 0;
	private initialization: Promise<void> | undefined;
	private modeTransition: Promise<void> = Promise.resolve();
	private applyingLayout = 0;
	private enforcementSuspended = false;
	private readonly enforcementScheduler = this._register(new RunOnceScheduler(() => void this.enforceAgentPortal(), 0));

	constructor(
		@IAiConfigService private readonly aiConfigService: IAiConfigService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IViewsService private readonly viewsService: IViewsService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	get mode(): AiHubMode {
		return this.currentMode;
	}

	initialize(): Promise<void> {
		if (!this.initialization) {
			this.initialization = this.doInitialize();
		}
		return this.initialization;
	}

	private async doInitialize(): Promise<void> {
		const state = await this.aiConfigService.getState();
		this.currentMode = state.mode;
		this.editChatProvider = state.editChatProvider;
		await this.aiConfigService.setMode(state.mode);
		this.applyShellClasses();
		const mode = this.getActiveAgentMode();
		const generation = ++this.surfaceGeneration;
		this.setAgentLoading(mode);
		// The native shell is ready at this point. Let it paint immediately while the
		// extension host creates and loads the selected agent webview in the background.
		void this.applyAgentPortal(mode, generation).catch(error => {
			this.logService.warn('[aiHub] failed to initialize agent extension portal', error);
		});
	}

	setMode(mode: AiHubMode): Promise<void> {
		const transition = this.modeTransition.then(async () => {
			await this.initialize();
			if (mode === this.currentMode) {
				this.applyShellClasses();
				await this.applyAgentPortal(this.getActiveAgentMode(), ++this.surfaceGeneration);
				return;
			}
			this.currentMode = mode;
			await this.aiConfigService.setMode(mode);
			this.applyShellClasses();
			await this.applyAgentPortal(this.getActiveAgentMode(), ++this.surfaceGeneration);
		});
		this.modeTransition = transition.then(() => undefined, () => undefined);
		return transition;
	}

	setEditChatProvider(provider: AiHubProvider): Promise<void> {
		const transition = this.modeTransition.then(async () => {
			await this.initialize();
			if (provider !== this.editChatProvider) {
				this.editChatProvider = provider;
				await this.aiConfigService.setEditChatProvider(provider);
			}
			if (this.currentMode === 'edit') {
				await this.applyAgentPortal(this.getActiveAgentMode(), ++this.surfaceGeneration);
			}
		});
		this.modeTransition = transition.then(() => undefined, () => undefined);
		return transition;
	}

	setEnforcementSuspended(suspended: boolean): void {
		this.enforcementSuspended = suspended;
		if (!suspended) {
			this.enforcementScheduler.schedule();
		}
	}

	private getActiveAgentMode(): AiHubAgentMode {
		if (this.currentMode !== 'edit') {
			return this.currentMode;
		}
		return this.editChatProvider === 'claude' ? 'claudeAgent' : 'codexAgent';
	}

	private getAgentContainerIds(mode: AiHubAgentMode): readonly string[] {
		return mode === 'claudeAgent' ? CLAUDE_AGENT_CONTAINER_IDS : CODEX_AGENT_CONTAINER_IDS;
	}

	private getAgentViewIds(mode: AiHubAgentMode): readonly string[] {
		return mode === 'claudeAgent' ? CLAUDE_AGENT_VIEW_IDS : CODEX_AGENT_VIEW_IDS;
	}

	private getAgentExtensionId(mode: AiHubAgentMode): string {
		return mode === 'claudeAgent' ? CLAUDE_EXTENSION_ID : CODEX_EXTENSION_ID;
	}

	private getAgentOpenCommand(mode: AiHubAgentMode): string {
		return mode === 'claudeAgent' ? 'claude-vscode.sidebar.open' : 'chatgpt.openSidebar';
	}

	private async openFirstAvailableViewContainer(containerIds: readonly string[], focus: boolean): Promise<boolean> {
		for (const id of containerIds) {
			try {
				if (await this.viewsService.openViewContainer(id, focus)) {
					return true;
				}
			} catch {
				// Try the next known extension container id.
			}
		}
		return false;
	}

	private async openFirstAvailableView(viewIds: readonly string[], focus: boolean): Promise<boolean> {
		for (const id of viewIds) {
			try {
				if (await this.viewsService.openView(id, focus)) {
					return true;
				}
			} catch {
				// Try the next known extension view id.
			}
		}
		return false;
	}

	private prepareHiddenWorkbenchFactory(): void {
		this.layoutService.setPartHidden(true, Parts.ACTIVITYBAR_PART);
		this.layoutService.setPartHidden(true, Parts.PANEL_PART);
		this.layoutService.setPartHidden(true, Parts.EDITOR_PART);
		this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
		this.layoutService.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		this.layoutService.layout();
	}

	private async applyAgentPortal(mode: AiHubAgentMode, generation: number): Promise<void> {
		this.applyingLayout++;
		this.setAgentLoading(mode);
		try {
			this.prepareHiddenWorkbenchFactory();
			let commandOpened = false;
			for (let attempt = 0; attempt < AGENT_SURFACE_RETRY_COUNT && this.isRequestCurrent(mode, generation); attempt++) {
				await this.openFirstAvailableViewContainer(this.getAgentContainerIds(mode), true);
				await this.openFirstAvailableView(this.getAgentViewIds(mode), true);
				if (!this.isRequestCurrent(mode, generation)) {
					return;
				}
				if (this.activateAgentPortal(mode)) {
					return;
				}

				if (!commandOpened) {
					try {
						await this.commandService.executeCommand(this.getAgentOpenCommand(mode));
						commandOpened = true;
					} catch (error) {
						if (attempt === AGENT_SURFACE_RETRY_COUNT - 1) {
							this.logService.warn('[aiHub] failed to open agent extension webview command', error);
						}
					}
				}

				await this.openFirstAvailableViewContainer(this.getAgentContainerIds(mode), true);
				await this.openFirstAvailableView(this.getAgentViewIds(mode), true);
				if (!this.isRequestCurrent(mode, generation)) {
					return;
				}
				if (this.activateAgentPortal(mode)) {
					return;
				}
				await timeout(AGENT_SURFACE_RETRY_DELAY);
			}
		} finally {
			this.applyingLayout--;
		}
	}

	private isRequestCurrent(mode: AiHubAgentMode, generation: number): boolean {
		return generation === this.surfaceGeneration && mode === this.getActiveAgentMode();
	}

	private activateAgentPortal(mode: AiHubAgentMode): boolean {
		const extensionId = this.getAgentExtensionId(mode).toLowerCase();
		// Move the extension iframe into the Bold portal as soon as it exists, but
		// keep the loading surface visible until VS Code marks the webview ready.
		const frame = Array.from(mainWindow.document.querySelectorAll<HTMLIFrameElement>('iframe.webview, iframe[src*="extensionId="]')).find(candidate => candidate.src.toLowerCase().includes(`extensionid=${extensionId}`));
		const portal = frame?.parentElement?.parentElement;
		if (!portal) {
			return false;
		}
		if (portal.parentElement !== mainWindow.document.body) {
			mainWindow.document.body.appendChild(portal);
		}
		for (const activePortal of mainWindow.document.querySelectorAll<HTMLElement>(`.${ACTIVE_AGENT_WEBVIEW_PORTAL_CLASS}`)) {
			if (activePortal !== portal) {
				activePortal.classList.remove(ACTIVE_AGENT_WEBVIEW_PORTAL_CLASS);
				activePortal.style.display = 'none';
			}
		}
		portal.style.display = '';
		portal.style.visibility = 'visible';
		portal.classList.add(ACTIVE_AGENT_WEBVIEW_PORTAL_CLASS);
		portal.dataset.agentMode = mode;
		for (const element of portal.querySelectorAll<HTMLElement>('*')) {
			element.style.visibility = 'visible';
		}
		mainWindow.requestAnimationFrame(() => mainWindow.dispatchEvent(new Event('resize')));
		const ready = frame.classList.contains('ready');
		if (ready) {
			mainWindow.document.body.classList.remove(AI_HUB_AGENT_LOADING_CLASS);
			delete mainWindow.document.body.dataset.agentLoadingLabel;
		}
		return ready;
	}

	private async enforceAgentPortal(): Promise<void> {
		if (this.enforcementSuspended || this.applyingLayout > 0) {
			return;
		}
		try {
			const mode = this.getActiveAgentMode();
			if (!this.activateAgentPortal(mode)) {
				await this.applyAgentPortal(mode, ++this.surfaceGeneration);
			}
		} catch (error) {
			this.logService.warn('[aiHub] failed to restore agent extension portal', error);
		}
	}

	private applyShellClasses(): void {
		mainWindow.document.body.classList.add(BOLD_FRONTEND_ACTIVE_CLASS);
		mainWindow.document.body.classList.toggle(AI_HUB_AGENT_MODE_CLASS, this.currentMode !== 'edit');
		mainWindow.document.body.classList.toggle(AI_HUB_EDIT_CHAT_MODE_CLASS, this.currentMode === 'edit');
	}

	private setAgentLoading(mode: AiHubAgentMode): void {
		mainWindow.document.body.classList.add(AI_HUB_AGENT_LOADING_CLASS);
		mainWindow.document.body.dataset.agentLoadingLabel = mode === 'claudeAgent' ? 'Claude Code' : 'Codex';
	}
}
