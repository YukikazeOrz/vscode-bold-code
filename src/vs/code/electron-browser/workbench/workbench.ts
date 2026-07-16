/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

(async function () {

	// Add a perf entry right from the top
	performance.mark('code/didStartRenderer');

	type ISandboxConfiguration = import('../../../base/parts/sandbox/common/sandboxTypes.js').ISandboxConfiguration;
	type ILoadResult<M, T extends ISandboxConfiguration> = import('../../../platform/window/electron-browser/window.js').ILoadResult<M, T>;
	type ILoadOptions<T extends ISandboxConfiguration> = import('../../../platform/window/electron-browser/window.js').ILoadOptions<T>;
	type INativeWindowConfiguration = import('../../../platform/window/common/window.ts').INativeWindowConfiguration;
	type IMainWindowSandboxGlobals = import('../../../base/parts/sandbox/electron-browser/globals.js').IMainWindowSandboxGlobals;
	type IDesktopMain = import('../../../workbench/electron-browser/desktop.main.js').IDesktopMain;

	const preloadGlobals = (window as unknown as { vscode: IMainWindowSandboxGlobals }).vscode; // defined by preload.ts
	const safeProcess = preloadGlobals.process;

	//#region Splash Screen Helpers

	function showSplash(configuration: INativeWindowConfiguration) {
		performance.mark('code/willShowPartsSplash');
		showDefaultSplash(configuration);
		performance.mark('code/didShowPartsSplash');
	}

	function showDefaultSplash(configuration: INativeWindowConfiguration) {
		const data = configuration.partsSplash;

		// Preserve the persisted zoom level, but never paint the cached VS Code parts.
		if (typeof data?.zoomLevel === 'number' && typeof preloadGlobals?.webFrame?.setZoomLevel === 'function') {
			preloadGlobals.webFrame.setZoomLevel(data.zoomLevel);
		}

		const style = document.createElement('style');
		style.className = 'initialShellColors';
		style.textContent = `
			body {
				margin: 0;
				padding: 0;
				background: #0b0e14;
				color: #d7dce6;
				font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
			}
			#monaco-parts-splash {
				position: fixed;
				z-index: 9000;
				inset: 0;
				display: grid;
				grid-template: "rail content" 1fr / 68px 1fr;
				overflow: hidden;
				background: #0b0e14;
				color: #d7dce6;
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			}
			.bold-initial-rail {
				grid-area: rail;
				display: flex;
				box-sizing: border-box;
				flex-direction: column;
				align-items: center;
				gap: 18px;
				padding: 47px 8px 12px;
				border-right: 1px solid #20252f;
				background: #0e1219;
			}
			.bold-initial-brand,
			.bold-initial-mark {
				display: grid;
				place-items: center;
				border: 1px solid #5897ff;
				background: linear-gradient(145deg, #4f91ff, #2456b8);
				box-shadow: 0 10px 28px rgb(43 105 222 / 28%);
				color: #fff;
				font-weight: 750;
			}
			.bold-initial-brand {
				width: 38px;
				height: 38px;
				border-radius: 12px;
			}
			.bold-initial-rail-item {
				display: grid;
				width: 34px;
				height: 34px;
				place-items: center;
				border-radius: 10px;
				color: #77808e;
				font-size: 13px;
			}
			.bold-initial-rail-spacer {
				flex: 1;
			}
			.bold-initial-explorer {
				display: none;
				box-sizing: border-box;
				flex-direction: column;
				gap: 10px;
				padding: 12px 12px 10px 16px;
				border-right: 1px solid #20252f;
				background: #11151c;
			}
			.bold-initial-eyebrow {
				color: #667080;
				font-size: 10px;
				font-weight: 700;
				letter-spacing: .12em;
			}
			.bold-initial-explorer strong {
				margin-bottom: 6px;
				font-size: 13px;
			}
			.bold-initial-tree-row {
				height: 8px;
				border-radius: 999px;
				background: #252b35;
				opacity: .72;
			}
			.bold-initial-topbar {
				display: none;
				align-items: end;
				padding: 0 10px;
				border-bottom: 1px solid #20252f;
				background: #0d1016;
				-webkit-app-region: drag;
			}
			.bold-initial-tab {
				min-width: 150px;
				padding: 12px 16px 11px;
				border: 1px solid #252b35;
				border-bottom: 0;
				border-radius: 10px 10px 0 0;
				color: #8e98a8;
				font-size: 12px;
			}
			.bold-initial-content {
				grid-area: content;
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: center;
				gap: 12px;
				margin: 0;
				border: 0;
				background: #11151b;
			}
			.bold-initial-mark {
				position: relative;
				width: 70px;
				height: 70px;
				border-radius: 22px;
				font-size: 13px;
				animation: bold-initial-breathe 1.8s ease-in-out infinite;
			}
			.bold-initial-mark::after {
				position: absolute;
				inset: -7px;
				border: 1px solid rgb(88 151 255 / 36%);
				border-radius: 27px;
				content: '';
				animation: bold-initial-ring 1.8s ease-out infinite;
			}
			.bold-initial-content strong {
				font-size: 17px;
			}
			.bold-initial-content span:last-child {
				color: #707b8b;
				font-size: 12px;
			}
			@keyframes bold-initial-breathe {
				50% { transform: translateY(-3px); }
			}
			@keyframes bold-initial-ring {
				0% { opacity: .8; transform: scale(.88); }
				75%, 100% { opacity: 0; transform: scale(1.16); }
			}
		`;
		window.document.head.appendChild(style);

		const splash = document.createElement('div');
		splash.id = 'monaco-parts-splash';

		const rail = document.createElement('div');
		rail.className = 'bold-initial-rail';
		const brand = document.createElement('span');
		brand.className = 'bold-initial-brand';
		brand.textContent = 'B';
		rail.append(brand);
		for (const label of ['C', 'X']) {
			const item = document.createElement('span');
			item.className = 'bold-initial-rail-item';
			item.textContent = label;
			rail.append(item);
		}
		const railSpacer = document.createElement('span');
		railSpacer.className = 'bold-initial-rail-spacer';
		const settings = document.createElement('span');
		settings.className = 'bold-initial-rail-item';
		settings.textContent = '⚙';
		rail.append(railSpacer, settings);

		const explorer = document.createElement('aside');
		explorer.className = 'bold-initial-explorer';
		const eyebrow = document.createElement('span');
		eyebrow.className = 'bold-initial-eyebrow';
		eyebrow.textContent = 'WORKSPACE';
		const workspace = document.createElement('strong');
		workspace.textContent = 'Bold Code';
		explorer.append(eyebrow, workspace);
		for (let index = 0; index < 8; index++) {
			const row = document.createElement('span');
			row.className = 'bold-initial-tree-row';
			row.style.width = `${52 + ((index * 17) % 38)}%`;
			explorer.append(row);
		}

		const topbar = document.createElement('header');
		topbar.className = 'bold-initial-topbar';
		const tab = document.createElement('span');
		tab.className = 'bold-initial-tab';
		tab.textContent = 'Welcome';
		topbar.append(tab);

		const content = document.createElement('main');
		content.className = 'bold-initial-content';
		const mark = document.createElement('span');
		mark.className = 'bold-initial-mark';
		mark.textContent = 'AI';
		const title = document.createElement('strong');
		title.textContent = '正在加载 Agent';
		const detail = document.createElement('span');
		detail.textContent = 'Bold 界面正在启动，随后将接入扩展 Web…';
		content.append(mark, title, detail);

		splash.append(rail, explorer, topbar, content);
		window.document.body.appendChild(splash);
	}

	//#endregion

	//#region Window Helpers

	async function load<M, T extends ISandboxConfiguration>(options: ILoadOptions<T>): Promise<ILoadResult<M, T>> {

		// Window Configuration from Preload Script
		const configuration = await resolveWindowConfiguration<T>();

		// Signal before import()
		options?.beforeImport?.(configuration);

		// Developer settings
		const { enableDeveloperKeybindings, removeDeveloperKeybindingsAfterLoad, developerDeveloperKeybindingsDisposable, forceDisableShowDevtoolsOnError } = setupDeveloperKeybindings(configuration, options);

		// NLS
		setupNLS<T>(configuration);

		// Compute base URL and set as global
		const baseUrl = new URL(`${fileUriFromPath(configuration.appRoot, { isWindows: safeProcess.platform === 'win32', scheme: 'vscode-file', fallbackAuthority: 'vscode-app' })}/out/`);
		globalThis._VSCODE_FILE_ROOT = baseUrl.toString();

		// Dev only: CSS import map tricks
		setupCSSImportMaps<T>(configuration, baseUrl);

		// ESM Import
		try {
			let workbenchUrl: string;
			if (!!safeProcess.env['VSCODE_DEV'] && globalThis._VSCODE_USE_RELATIVE_IMPORTS) {
				workbenchUrl = '../../../workbench/workbench.desktop.main.js'; // for dev purposes only
			} else {
				workbenchUrl = new URL(`vs/workbench/workbench.desktop.main.js`, baseUrl).href;
			}

			const result = await import(workbenchUrl);
			if (developerDeveloperKeybindingsDisposable && removeDeveloperKeybindingsAfterLoad) {
				developerDeveloperKeybindingsDisposable();
			}

			return { result, configuration };
		} catch (error) {
			onUnexpectedError(error, enableDeveloperKeybindings && !forceDisableShowDevtoolsOnError);

			throw error;
		}
	}

	async function resolveWindowConfiguration<T extends ISandboxConfiguration>() {
		const timeout = setTimeout(() => { console.error(`[resolve window config] Could not resolve window configuration within 10 seconds, but will continue to wait...`); }, 10000);
		performance.mark('code/willWaitForWindowConfig');

		const configuration = await preloadGlobals.context.resolveConfiguration() as T;
		performance.mark('code/didWaitForWindowConfig');

		clearTimeout(timeout);

		return configuration;
	}

	function setupDeveloperKeybindings<T extends ISandboxConfiguration>(configuration: T, options: ILoadOptions<T>) {
		const {
			forceEnableDeveloperKeybindings,
			disallowReloadKeybinding,
			removeDeveloperKeybindingsAfterLoad,
			forceDisableShowDevtoolsOnError
		} = typeof options?.configureDeveloperSettings === 'function' ? options.configureDeveloperSettings(configuration) : {
			forceEnableDeveloperKeybindings: false,
			disallowReloadKeybinding: false,
			removeDeveloperKeybindingsAfterLoad: false,
			forceDisableShowDevtoolsOnError: false
		};

		const isDev = !!safeProcess.env['VSCODE_DEV'];
		const enableDeveloperKeybindings = Boolean(isDev || forceEnableDeveloperKeybindings);
		let developerDeveloperKeybindingsDisposable: Function | undefined = undefined;
		if (enableDeveloperKeybindings) {
			developerDeveloperKeybindingsDisposable = registerDeveloperKeybindings(disallowReloadKeybinding);
		}

		return {
			enableDeveloperKeybindings,
			removeDeveloperKeybindingsAfterLoad,
			developerDeveloperKeybindingsDisposable,
			forceDisableShowDevtoolsOnError
		};
	}

	function registerDeveloperKeybindings(disallowReloadKeybinding: boolean | undefined): Function {
		const ipcRenderer = preloadGlobals.ipcRenderer;

		const extractKey =
			function (e: KeyboardEvent) {
				return [
					e.ctrlKey ? 'ctrl-' : '',
					e.metaKey ? 'meta-' : '',
					e.altKey ? 'alt-' : '',
					e.shiftKey ? 'shift-' : '',
					e.keyCode
				].join('');
			};

		// Devtools & reload support
		const TOGGLE_DEV_TOOLS_KB = (safeProcess.platform === 'darwin' ? 'meta-alt-73' : 'ctrl-shift-73'); // mac: Cmd-Alt-I, rest: Ctrl-Shift-I
		const TOGGLE_DEV_TOOLS_KB_ALT = '123'; // F12
		const RELOAD_KB = (safeProcess.platform === 'darwin' ? 'meta-82' : 'ctrl-82'); // mac: Cmd-R, rest: Ctrl-R

		let listener: ((e: KeyboardEvent) => void) | undefined = function (e) {
			const key = extractKey(e);
			if (key === TOGGLE_DEV_TOOLS_KB || key === TOGGLE_DEV_TOOLS_KB_ALT) {
				ipcRenderer.send('vscode:toggleDevTools');
			} else if (key === RELOAD_KB && !disallowReloadKeybinding) {
				ipcRenderer.send('vscode:reloadWindow');
			}
		};

		window.addEventListener('keydown', listener);

		return function () {
			if (listener) {
				window.removeEventListener('keydown', listener);
				listener = undefined;
			}
		};
	}

	function setupNLS<T extends ISandboxConfiguration>(configuration: T): void {
		globalThis._VSCODE_NLS_MESSAGES = configuration.nls.messages;
		globalThis._VSCODE_NLS_LANGUAGE = configuration.nls.language;

		let language = configuration.nls.language || 'en';
		if (language === 'zh-tw') {
			language = 'zh-Hant';
		} else if (language === 'zh-cn') {
			language = 'zh-Hans';
		}

		window.document.documentElement.setAttribute('lang', language);
	}

	function onUnexpectedError(error: string | Error, showDevtoolsOnError: boolean): void {
		if (showDevtoolsOnError) {
			const ipcRenderer = preloadGlobals.ipcRenderer;
			ipcRenderer.send('vscode:openDevTools');
		}

		console.error(`[uncaught exception]: ${error}`);

		if (error && typeof error !== 'string' && error.stack) {
			console.error(error.stack);
		}
	}

	function fileUriFromPath(path: string, config: { isWindows?: boolean; scheme?: string; fallbackAuthority?: string }): string {

		// Since we are building a URI, we normalize any backslash
		// to slashes and we ensure that the path begins with a '/'.
		let pathName = path.replace(/\\/g, '/');
		if (pathName.length > 0 && pathName.charAt(0) !== '/') {
			pathName = `/${pathName}`;
		}

		let uri: string;

		// Windows: in order to support UNC paths (which start with '//')
		// that have their own authority, we do not use the provided authority
		// but rather preserve it.
		if (config.isWindows && pathName.startsWith('//')) {
			uri = encodeURI(`${config.scheme || 'file'}:${pathName}`);
		}

		// Otherwise we optionally add the provided authority if specified
		else {
			uri = encodeURI(`${config.scheme || 'file'}://${config.fallbackAuthority || ''}${pathName}`);
		}

		return uri.replace(/#/g, '%23');
	}

	function setupCSSImportMaps<T extends ISandboxConfiguration>(configuration: T, baseUrl: URL) {

		// DEV ---------------------------------------------------------------------------------------
		// DEV: This is for development and enables loading CSS via import-statements via import-maps.
		// DEV: For each CSS modules that we have we defined an entry in the import map that maps to
		// DEV: a blob URL that loads the CSS via a dynamic @import-rule.
		// DEV ---------------------------------------------------------------------------------------

		if (globalThis._VSCODE_DISABLE_CSS_IMPORT_MAP) {
			return; // disabled in certain development setups
		}

		if (Array.isArray(configuration.cssModules) && configuration.cssModules.length > 0) {
			performance.mark('code/willAddCssLoader');

			globalThis._VSCODE_CSS_LOAD = function (url) {
				const link = document.createElement('link');
				link.setAttribute('rel', 'stylesheet');
				link.setAttribute('type', 'text/css');
				link.setAttribute('href', url);

				window.document.head.appendChild(link);
			};

			const importMap: { imports: Record<string, string> } = { imports: {} };
			for (const cssModule of configuration.cssModules) {
				const cssUrl = new URL(cssModule, baseUrl).href;
				const jsSrc = `globalThis._VSCODE_CSS_LOAD('${cssUrl}');\n`;
				const blob = new Blob([jsSrc], { type: 'application/javascript' });
				importMap.imports[cssUrl] = URL.createObjectURL(blob);
			}

			const ttp = window.trustedTypes?.createPolicy('vscode-bootstrapImportMap', { createScript(value) { return value; }, });
			const importMapSrc = JSON.stringify(importMap, undefined, 2);
			const importMapScript = document.createElement('script');
			importMapScript.type = 'importmap';
			importMapScript.setAttribute('nonce', '0c6a828f1297');
			// @ts-expect-error
			importMapScript.textContent = ttp?.createScript(importMapSrc) ?? importMapSrc;
			window.document.head.appendChild(importMapScript);

			performance.mark('code/didAddCssLoader');
		}
	}

	//#endregion

	const { result, configuration } = await load<IDesktopMain, INativeWindowConfiguration>(
		{
			configureDeveloperSettings: function (windowConfig) {
				return {
					// disable automated devtools opening on error when running extension tests
					// as this can lead to nondeterministic test execution (devtools steals focus)
					forceDisableShowDevtoolsOnError: typeof windowConfig.extensionTestsPath === 'string' || windowConfig['enable-smoke-test-driver'] === true,
					// enable devtools keybindings in extension development window
					forceEnableDeveloperKeybindings: Array.isArray(windowConfig.extensionDevelopmentPath) && windowConfig.extensionDevelopmentPath.length > 0,
					removeDeveloperKeybindingsAfterLoad: true
				};
			},
			beforeImport: function (windowConfig) {

				// Show our splash as early as possible
				showSplash(windowConfig);

				// Code windows have a `vscodeWindowId` property to identify them
				Object.defineProperty(window, 'vscodeWindowId', {
					get: () => windowConfig.windowId
				});

				// It looks like browsers only lazily enable
				// the <canvas> element when needed. Since we
				// leverage canvas elements in our code in many
				// locations, we try to help the browser to
				// initialize canvas when it is idle, right
				// before we wait for the scripts to be loaded.
				window.requestIdleCallback(() => {
					const canvas = document.createElement('canvas');
					const context = canvas.getContext('2d');
					context?.clearRect(0, 0, canvas.width, canvas.height);
					canvas.remove();
				}, { timeout: 50 });

				// Track import() perf
				performance.mark('code/willLoadWorkbenchMain');
			}
		}
	);

	// Mark start of workbench
	performance.mark('code/didLoadWorkbenchMain');

	// Load workbench
	result.main(configuration);
}());
