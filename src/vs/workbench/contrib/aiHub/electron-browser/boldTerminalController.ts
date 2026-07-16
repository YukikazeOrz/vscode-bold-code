/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { importAMDNodeModule } from '../../../../amdX.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { ILocalPtyService, IProcessDataEvent, IShellLaunchConfig, ITerminalProcessOptions, TerminalIpcChannels } from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

/** A custom xterm surface connected directly to VS Code's existing local PTY host. */
export class BoldTerminalController extends Disposable {

	private readonly container: HTMLElement;
	private readonly terminalHost: HTMLElement;
	private readonly processDisposables = this._register(new DisposableStore());
	private readonly ptyService: ILocalPtyService;
	private terminal: XtermTerminal | undefined;
	private processId: number | undefined;
	private starting: Promise<void> | undefined;

	constructor(
		document: Document,
		mainProcessService: IMainProcessService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly environmentService: INativeEnvironmentService,
	) {
		super();
		this.ptyService = ProxyChannel.toService<ILocalPtyService>(mainProcessService.getChannel(TerminalIpcChannels.LocalPty));
		this.container = document.createElement('section');
		this.container.className = 'bold-terminal';
		this.container.setAttribute('aria-hidden', 'true');
		this.container.inert = true;
		const header = document.createElement('header');
		const title = document.createElement('strong');
		title.textContent = 'TERMINAL';
		const actions = document.createElement('div');
		const restart = document.createElement('button');
		restart.type = 'button';
		restart.textContent = '重新启动';
		restart.addEventListener('click', () => void this.restart());
		const close = document.createElement('button');
		close.type = 'button';
		close.textContent = '×';
		close.setAttribute('aria-label', '关闭终端');
		close.addEventListener('click', () => this.hide());
		actions.append(restart, close);
		header.append(title, actions);
		this.terminalHost = document.createElement('div');
		this.terminalHost.className = 'bold-terminal__xterm';
		this.container.append(header, this.terminalHost);
		document.body.append(this.container);
		this._register(toDisposable(() => this.container.remove()));

		const resizeObserver = new mainWindow.ResizeObserver(() => this.layout());
		resizeObserver.observe(this.terminalHost);
		this._register(toDisposable(() => resizeObserver.disconnect()));
	}

	async toggle(): Promise<void> {
		if (this.isOpen()) {
			this.hide();
			return;
		}
		await this.show();
	}

	async show(): Promise<void> {
		this.container.classList.add('is-open');
		this.container.setAttribute('aria-hidden', 'false');
		this.container.inert = false;
		await this.ensureStarted();
		this.layout();
		this.terminal?.focus();
	}

	hide(): void {
		this.container.classList.remove('is-open');
		this.container.setAttribute('aria-hidden', 'true');
		this.container.inert = true;
	}

	isOpen(): boolean {
		return this.container.classList.contains('is-open');
	}

	private ensureStarted(): Promise<void> {
		if (!this.starting) {
			this.starting = this.start();
		}
		return this.starting;
	}

	private async start(): Promise<void> {
		const { Terminal } = await importAMDNodeModule<typeof import('@xterm/xterm')>('@xterm/xterm', 'lib/xterm.js');
		const terminal = this.terminal = new Terminal({
			allowProposedApi: false,
			convertEol: false,
			cursorBlink: true,
			fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
			fontSize: 12,
			lineHeight: 1.25,
			scrollback: 5000,
			theme: {
				background: '#0f131a',
				foreground: '#d2d8e2',
				cursor: '#73a5ff',
				selectionBackground: '#315b965c',
			},
		});
		terminal.open(this.terminalHost);
		this.layout();

		const workspace = this.workspaceContextService.getWorkspace();
		const folder = workspace.folders[0];
		const cwd = folder?.uri.scheme === 'file' ? folder.uri.fsPath : this.environmentService.userHome.fsPath;
		const [shell, env] = await Promise.all([this.ptyService.getDefaultSystemShell(), this.ptyService.getEnvironment()]);
		const shellLaunchConfig: IShellLaunchConfig = { executable: shell, args: [], cwd };
		const options: ITerminalProcessOptions = {
			shellIntegration: { enabled: false, suggestEnabled: false, nonce: '' },
			windowsUseConptyDll: false,
			environmentVariableCollections: undefined,
			workspaceFolder: folder,
			isScreenReaderOptimized: false,
		};
		const id = await this.ptyService.createProcess(
			shellLaunchConfig,
			cwd,
			terminal.cols,
			terminal.rows,
			'11',
			env,
			env,
			options,
			false,
			workspace.id,
			workspace.folders.length === 1 ? workspace.folders[0].name : 'Bold Code',
		);
		this.processId = id;
		this.processDisposables.add(this.ptyService.onProcessData(event => {
			if (event.id !== id) {
				return;
			}
			const data = typeof event.event === 'string' ? event.event : (event.event as IProcessDataEvent).data;
			terminal.write(data, () => void this.ptyService.acknowledgeDataEvent(id, data.length));
		}));
		this.processDisposables.add(this.ptyService.onProcessExit(event => {
			if (event.id === id) {
				terminal.write(`\r\n\x1b[90m[进程已退出${typeof event.event === 'number' ? ` · ${event.event}` : ''}]\x1b[0m\r\n`);
			}
		}));
		this.processDisposables.add(terminal.onData(data => void this.ptyService.input(id, data)));
		this.processDisposables.add(terminal.onResize(size => void this.ptyService.resize(id, size.cols, size.rows)));
		const launchError = await this.ptyService.start(id);
		if (launchError && 'message' in launchError) {
			terminal.write(`\r\n\x1b[31m${launchError.message}\x1b[0m\r\n`);
		}
	}

	private layout(): void {
		const terminal = this.terminal;
		if (!terminal || !this.container.classList.contains('is-open')) {
			return;
		}
		const rect = this.terminalHost.getBoundingClientRect();
		if (rect.width < 40 || rect.height < 40) {
			return;
		}
		const cols = Math.max(20, Math.floor((rect.width - 18) / 7.25));
		const rows = Math.max(3, Math.floor((rect.height - 12) / 15.5));
		if (terminal.cols !== cols || terminal.rows !== rows) {
			terminal.resize(cols, rows);
		}
	}

	private async restart(): Promise<void> {
		const processId = this.processId;
		this.processId = undefined;
		this.starting = undefined;
		this.processDisposables.clear();
		this.terminal?.dispose();
		this.terminal = undefined;
		this.terminalHost.replaceChildren();
		if (typeof processId === 'number') {
			await this.ptyService.shutdown(processId, true);
		}
		await this.ensureStarted();
	}

	override dispose(): void {
		const processId = this.processId;
		if (typeof processId === 'number') {
			void this.ptyService.shutdown(processId, true);
		}
		this.terminal?.dispose();
		super.dispose();
	}
}
