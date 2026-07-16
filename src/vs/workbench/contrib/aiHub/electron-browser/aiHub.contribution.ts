/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/boldFrontend.css';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IAiExtensionHostEnvironmentContributor } from '../../../../platform/environment/common/aiExtensionHostEnvironment.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { EditorExtensionsRegistry } from '../../../../editor/browser/editorExtensions.js';
import { FindController } from '../../../../editor/contrib/find/browser/findController.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { BoldFrontendApp } from '../frontend/boldFrontendApp.js';
import { AiConfigService } from './aiConfigService.js';
import { AiHubModeController } from './aiHubModeController.js';
import { AI_GATEWAY_OPEN_COMMAND_ID, AI_HUB_OPEN_COMMAND_ID, BOLD_FRONTEND_ACTIVE_CLASS, BOLD_FRONTEND_BOOTSTRAP_CLASS, IAiConfigService, IAiHubModeController } from './aiHubTypes.js';
import { BoldFrontendWorkbenchBridge } from './boldFrontendWorkbenchBridge.js';
import { getSimpleCodeEditorWidgetOptions } from '../../codeEditor/browser/simpleEditorOptions.js';

/**
 * Installed while the workbench module is being evaluated, before VS Code creates its parts.
 * The actual frontend is hydrated later, once the backend services are ready.
 */
function installBoldFrontendBootstrap(): HTMLElement {
	const document = mainWindow.document;
	document.documentElement.classList.add(BOLD_FRONTEND_BOOTSTRAP_CLASS);
	document.body.classList.add(BOLD_FRONTEND_ACTIVE_CLASS);
	// The electron entry point has already painted a Bold-shaped splash before
	// this contribution is evaluated. Reuse it until the app is hydrated: making
	// a second bootstrap here was the one-frame startup flash.
	const earlySplash = document.getElementById('monaco-parts-splash');
	if (earlySplash) {
		earlySplash.setAttribute('role', 'progressbar');
		earlySplash.setAttribute('aria-label', 'Bold Code 正在启动');
		return earlySplash;
	}

	const screen = document.createElement('div');
	screen.className = 'bold-frontend-bootstrap';
	screen.setAttribute('role', 'progressbar');
	screen.setAttribute('aria-label', 'Bold Code 正在启动');

	const rail = document.createElement('div');
	rail.className = 'bold-frontend-bootstrap__rail';
	const brand = document.createElement('span');
	brand.className = 'bold-frontend-bootstrap__brand';
	brand.textContent = 'B';
	rail.append(brand);
	for (const label of ['▱', '⌕', '>_', 'C', 'X']) {
		const item = document.createElement('span');
		item.className = 'bold-frontend-bootstrap__rail-item';
		item.textContent = label;
		rail.append(item);
	}

	const explorer = document.createElement('aside');
	explorer.className = 'bold-frontend-bootstrap__explorer';
	const eyebrow = document.createElement('span');
	eyebrow.className = 'bold-frontend-bootstrap__eyebrow';
	eyebrow.textContent = 'WORKSPACE';
	const workspace = document.createElement('strong');
	workspace.textContent = 'Bold Code';
	explorer.append(eyebrow, workspace);
	for (let index = 0; index < 8; index++) {
		const row = document.createElement('span');
		row.className = 'bold-frontend-bootstrap__tree-row';
		row.style.setProperty('--row-width', `${52 + ((index * 17) % 38)}%`);
		explorer.append(row);
	}

	const topbar = document.createElement('header');
	topbar.className = 'bold-frontend-bootstrap__topbar';
	const tab = document.createElement('span');
	tab.className = 'bold-frontend-bootstrap__tab';
	tab.textContent = 'Welcome';
	topbar.append(tab);

	const content = document.createElement('main');
	content.className = 'bold-frontend-bootstrap__content';
	const mark = document.createElement('span');
	mark.className = 'bold-frontend-bootstrap__mark';
	mark.textContent = 'B';
	const title = document.createElement('strong');
	title.textContent = 'Bold Code';
	const detail = document.createElement('span');
	detail.textContent = '正在连接工作区服务…';
	content.append(mark, title, detail);

	screen.append(rail, explorer, topbar, content);
	document.body.append(screen);
	return screen;
}

const boldFrontendBootstrap = installBoldFrontendBootstrap();
let activeBoldFrontendApp: BoldFrontendApp | undefined;

class BoldFrontendContribution extends Disposable {
	static readonly ID = 'workbench.contrib.boldFrontend';

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IAiHubModeController private readonly modeController: IAiHubModeController,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@ILogService private readonly logService: ILogService,
		@IModelService private readonly modelService: IModelService,
		@ILanguageService private readonly languageService: ILanguageService,
	) {
		super();
		void this.initialize().catch(error => {
			this.logService.error('[aiHub] failed to initialize the Bold frontend', error);
			boldFrontendBootstrap.setAttribute('aria-label', 'Bold Code 启动失败');
			const detail = boldFrontendBootstrap.querySelector('.bold-frontend-bootstrap__content > span:last-child');
			detail?.replaceChildren(mainWindow.document.createTextNode('界面启动失败，请重新打开应用。'));
		});
	}

	private async initialize(): Promise<void> {
		const bridge = this._register(this.instantiationService.createInstance(BoldFrontendWorkbenchBridge));
		const app = this._register(new BoldFrontendApp(mainWindow.document, bridge, {
			createEditor: (host, options) => {
				const simpleOptions = getSimpleCodeEditorWidgetOptions();
				return this.instantiationService.createInstance(CodeEditorWidget, host, options, {
					...simpleOptions,
					// Bold owns the tabs, while the editor keeps standard in-editor Find.
					contributions: [
						...(simpleOptions.contributions ?? []),
						...EditorExtensionsRegistry.getSomeEditorContributions([FindController.ID]),
					],
				});
			},
			createModel: (contents, languageId, uri) => this.modelService.createModel(contents, this.languageService.createById(languageId), uri),
		}));
		activeBoldFrontendApp = app;
		mainWindow.document.body.append(app.element);
		this._register(toDisposable(() => {
			if (activeBoldFrontendApp === app) {
				activeBoldFrontendApp = undefined;
			}
		}));
		await this.modeController.initialize();
		this.layoutService.layout();
		// Reveal the real single-agent shell as soon as its framework is laid out.
		// Agent webview activation continues behind the shell's loading surface.
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		boldFrontendBootstrap.remove();
		mainWindow.document.documentElement.classList.remove(BOLD_FRONTEND_BOOTSTRAP_CLASS);
		await app.start();
	}
}

registerSingleton(IAiConfigService, AiConfigService, InstantiationType.Delayed);
registerSingleton(IAiExtensionHostEnvironmentContributor, AiConfigService, InstantiationType.Delayed);
registerSingleton(IAiHubModeController, AiHubModeController, InstantiationType.Delayed);

CommandsRegistry.registerCommand(AI_GATEWAY_OPEN_COMMAND_ID, () => {
	return activeBoldFrontendApp?.openGateway();
});

CommandsRegistry.registerCommand(AI_HUB_OPEN_COMMAND_ID, () => {
	return activeBoldFrontendApp?.toggleSettings();
});

registerWorkbenchContribution2(BoldFrontendContribution.ID, BoldFrontendContribution, WorkbenchPhase.AfterRestored);
