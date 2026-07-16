/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomFactor } from '../../../../base/browser/browser.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { BrowserViewStorageScope, IBrowserViewService } from '../../../../platform/browserView/common/browserView.js';
import { BoldFrontendProvider, IBoldGatewayAccount, IBoldGatewayApiKey, IBoldGatewayGroup } from '../frontend/boldFrontendProtocol.js';

type GatewayStatus = 'authenticated' | 'signedOut' | 'twoFactor' | 'error';

interface IGatewayApiKeySecret extends IBoldGatewayApiKey {
	readonly key: string;
}

interface IGatewayScriptResult {
	readonly status: GatewayStatus;
	readonly accountLabel?: string;
	readonly email?: string;
	readonly balance?: number;
	readonly todayUsage?: number;
	readonly apiBaseUrl?: string;
	readonly apiKeys?: readonly IGatewayApiKeySecret[];
	readonly groups?: readonly IBoldGatewayGroup[];
	readonly message?: string;
	readonly tempToken?: string;
	readonly userEmailMasked?: string;
}

const GATEWAY_VIEW_ID = 'bold-ai-gateway';
const KEY_POLL_INTERVAL = 2000;
const ACCOUNT_CACHE_TTL = 60_000;

const SESSION_SCRIPT = `(async () => {
	const storage = window.localStorage;
	const clearAuth = () => ['auth_token', 'refresh_token', 'auth_user', 'token_expires_at', 'pending_auth_session'].forEach(key => storage.removeItem(key));
	const unwrap = payload => payload && typeof payload.code === 'number' ? (payload.code === 0 ? payload.data : undefined) : payload;
	const readJson = async response => { try { return await response.json(); } catch { return undefined; } };
	const request = (path, token, init = {}) => fetch('/api/v1' + path, { ...init, credentials: 'include', headers: { ...(init.headers || {}), Authorization: 'Bearer ' + token } });
	const requestAllKeys = async token => {
		const items = [];
		for (let page = 1; ; page++) {
			const response = await request('/keys?page=' + page + '&page_size=100&status=active&sort_by=created_at&sort_order=desc', token);
			const payload = await readJson(response);
			if (!response.ok || (payload && typeof payload.code === 'number' && payload.code !== 0)) { throw new Error(payload?.message || '读取 API Key 失败'); }
			const data = unwrap(payload) || {};
			items.push(...(Array.isArray(data.items) ? data.items : []));
			if (page >= Number(data.pages || 1)) { return items; }
		}
	};
	try {
		let token = storage.getItem('auth_token');
		if (!token) { return { status: 'signedOut' }; }
		let response = await request('/auth/me', token);
		if (response.status === 401) {
			const refreshToken = storage.getItem('refresh_token');
			if (!refreshToken) { clearAuth(); return { status: 'signedOut' }; }
			const refreshResponse = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
			const refreshed = unwrap(await readJson(refreshResponse));
			if (!refreshResponse.ok || typeof refreshed?.access_token !== 'string') { clearAuth(); return { status: 'signedOut' }; }
			token = refreshed.access_token;
			storage.setItem('auth_token', token);
			if (typeof refreshed.refresh_token === 'string') { storage.setItem('refresh_token', refreshed.refresh_token); }
			response = await request('/auth/me', token);
		}
		const userPayload = await readJson(response);
		if (!response.ok || (userPayload && typeof userPayload.code === 'number' && userPayload.code !== 0)) { return { status: response.status === 401 ? 'signedOut' : 'error', message: userPayload?.message || '读取账号失败' }; }
		const [items, groupsResponse, statsResponse, settingsResponse] = await Promise.all([
			requestAllKeys(token),
			request('/groups/available', token),
			request('/usage/dashboard/stats', token),
			request('/settings/public', token),
		]);
		const [groupsPayload, statsPayload, settingsPayload] = await Promise.all([groupsResponse, statsResponse, settingsResponse].map(readJson));
		if (!groupsResponse.ok || !statsResponse.ok) { return { status: 'error', message: '读取 Gateway 账号数据失败' }; }
		const userData = unwrap(userPayload);
		const user = userData?.user || userData || {};
		const groupsData = unwrap(groupsPayload);
		const stats = unwrap(statsPayload) || {};
		const settings = unwrap(settingsPayload) || {};
		const groups = Array.isArray(groupsData) ? groupsData : Array.isArray(groupsData?.items) ? groupsData.items : [];
		const apiBaseUrl = typeof settings.api_base_url === 'string' && settings.api_base_url.trim() ? settings.api_base_url.trim() : window.location.origin;
		return {
			status: 'authenticated',
			accountLabel: user.username || user.name || user.display_name || user.email,
			email: user.email,
			balance: Number(user.balance) || 0,
			todayUsage: Number(stats.today_actual_cost) || 0,
			apiBaseUrl,
			apiKeys: items.filter(item => item?.status === 'active' && typeof item?.key === 'string').map(item => ({
				id: Number(item.id), name: String(item.name || '未命名 API'), key: item.key.trim(), status: String(item.status || 'active'),
				groupId: item.group_id == null && item.group?.id == null ? undefined : Number(item.group_id ?? item.group.id), groupName: item.group?.name,
				platform: item.group?.platform, allowMessagesDispatch: item.group?.allow_messages_dispatch === true,
			})),
			groups: groups.filter(group => Number.isFinite(Number(group?.id))).map(group => ({
				id: Number(group.id), name: String(group.name || '未命名分组'), platform: String(group.platform || ''),
				description: typeof group.description === 'string' ? group.description : undefined,
				allowMessagesDispatch: group.allow_messages_dispatch === true,
			})),
		};
	} catch (error) { return { status: 'error', message: error instanceof Error ? error.message : '无法连接 AI Gateway' }; }
})()`;

const LOGOUT_SCRIPT = `(async () => {
	const storage = window.localStorage;
	const token = storage.getItem('auth_token');
	const refreshToken = storage.getItem('refresh_token');
	try {
		if (token) { await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ refresh_token: refreshToken }) }); }
	} catch {}
	['auth_token', 'refresh_token', 'auth_user', 'token_expires_at', 'pending_auth_session'].forEach(key => storage.removeItem(key));
	return { status: 'signedOut' };
})()`;

function updateGroupScript(apiKeyId: number, groupId: number): string {
	return `(async () => {
		const token = localStorage.getItem('auth_token');
		if (!token) { return { status: 'signedOut' }; }
		try {
			const response = await fetch('/api/v1/keys/${apiKeyId}', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ group_id: ${groupId} }) });
			let payload; try { payload = await response.json(); } catch { payload = undefined; }
			return response.ok && (!payload || typeof payload.code !== 'number' || payload.code === 0) ? { status: 'authenticated' } : { status: 'error', message: payload?.message || '更新 API 分组失败' };
		} catch (error) { return { status: 'error', message: error instanceof Error ? error.message : '更新 API 分组失败' }; }
	})()`;
}

function loginScript(email: string, password: string): string {
	const credentials = JSON.stringify({ email, password });
	return `(async () => {
		try {
			const response = await fetch('/api/v1/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(${credentials}) });
			let payload; try { payload = await response.json(); } catch { payload = undefined; }
			if (!response.ok || (payload && typeof payload.code === 'number' && payload.code !== 0)) { return { status: 'error', message: payload?.message || '登录失败' }; }
			const data = payload && typeof payload.code === 'number' ? payload.data : payload;
			if (data?.requires_2fa === true && typeof data.temp_token === 'string') { return { status: 'twoFactor', tempToken: data.temp_token, userEmailMasked: data.user_email_masked }; }
			if (typeof data?.access_token !== 'string') { return { status: 'error', message: '登录响应中没有访问令牌' }; }
			localStorage.setItem('auth_token', data.access_token);
			if (typeof data.refresh_token === 'string') { localStorage.setItem('refresh_token', data.refresh_token); }
			if (data.user) { localStorage.setItem('auth_user', JSON.stringify(data.user)); }
			return { status: 'authenticated' };
		} catch (error) { return { status: 'error', message: error instanceof Error ? error.message : '无法连接 AI Gateway' }; }
	})()`;
}

function twoFactorScript(tempToken: string, code: string): string {
	const request = JSON.stringify({ temp_token: tempToken, totp_code: code });
	return `(async () => {
		try {
			const response = await fetch('/api/v1/auth/login/2fa', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(${request}) });
			let payload; try { payload = await response.json(); } catch { payload = undefined; }
			if (!response.ok || (payload && typeof payload.code === 'number' && payload.code !== 0)) { return { status: 'error', message: payload?.message || '验证码错误' }; }
			const data = payload && typeof payload.code === 'number' ? payload.data : payload;
			if (typeof data?.access_token !== 'string') { return { status: 'error', message: '登录响应中没有访问令牌' }; }
			localStorage.setItem('auth_token', data.access_token);
			if (typeof data.refresh_token === 'string') { localStorage.setItem('refresh_token', data.refresh_token); }
			return { status: 'authenticated' };
		} catch (error) { return { status: 'error', message: error instanceof Error ? error.message : '无法连接 AI Gateway' }; }
	})()`;
}

function parseResult(value: unknown): IGatewayScriptResult | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const result = value as Record<string, unknown>;
	if (!['authenticated', 'signedOut', 'twoFactor', 'error'].includes(String(result.status))) {
		return undefined;
	}
	const apiKeys = Array.isArray(result.apiKeys) ? result.apiKeys.filter(value => value && typeof value === 'object').map(value => {
		const key = value as Record<string, unknown>;
		return {
			id: Number(key.id), name: typeof key.name === 'string' ? key.name : '未命名 API', key: typeof key.key === 'string' ? key.key : '',
			maskedKey: maskApiKey(typeof key.key === 'string' ? key.key : ''), status: typeof key.status === 'string' ? key.status : 'active',
			groupId: key.groupId == null ? undefined : Number(key.groupId), groupName: typeof key.groupName === 'string' ? key.groupName : undefined,
			platform: typeof key.platform === 'string' ? key.platform : undefined, allowMessagesDispatch: key.allowMessagesDispatch === true,
		};
	}).filter(key => Number.isFinite(key.id) && key.key.length > 0) : [];
	const groups = Array.isArray(result.groups) ? result.groups.filter(value => value && typeof value === 'object').map(value => {
		const group = value as Record<string, unknown>;
		return {
			id: Number(group.id), name: typeof group.name === 'string' ? group.name : '未命名分组', platform: typeof group.platform === 'string' ? group.platform : '',
			description: typeof group.description === 'string' ? group.description : undefined, allowMessagesDispatch: group.allowMessagesDispatch === true,
		};
	}).filter(group => Number.isFinite(group.id)) : [];
	return {
		status: result.status as GatewayStatus,
		accountLabel: typeof result.accountLabel === 'string' ? result.accountLabel : undefined,
		email: typeof result.email === 'string' ? result.email : undefined,
		balance: typeof result.balance === 'number' ? result.balance : undefined,
		todayUsage: typeof result.todayUsage === 'number' ? result.todayUsage : undefined,
		apiBaseUrl: typeof result.apiBaseUrl === 'string' ? result.apiBaseUrl : undefined,
		apiKeys,
		groups,
		message: typeof result.message === 'string' ? result.message : undefined,
		tempToken: typeof result.tempToken === 'string' ? result.tempToken : undefined,
		userEmailMasked: typeof result.userEmailMasked === 'string' ? result.userEmailMasked : undefined,
	};
}

function maskApiKey(apiKey: string): string {
	return apiKey.length > 8 ? `${apiKey.slice(0, 4)}....${apiKey.slice(-4)}` : '********';
}

/** Custom Gateway UI backed directly by the main-process BrowserView channel. */
export class BoldGatewayController extends Disposable {

	private readonly container: HTMLElement;
	private readonly content: HTMLElement;
	private readonly browserHost: HTMLElement;
	private readonly viewDisposables = this._register(new DisposableStore());
	private browserCreated = false;
	private browserVisible = false;
	private managedPageOpen = false;
	private waitingForKey = false;
	private requestInProgress = false;
	private cachedResult: IGatewayScriptResult | undefined;
	private cacheTimestamp = 0;
	private sessionRequest: Promise<IGatewayScriptResult> | undefined;
	private readonly initialCleanup: Promise<void>;

	constructor(
		private readonly document: Document,
		private readonly windowId: number,
		private readonly gatewayUrl: string,
		private readonly browserViewService: IBrowserViewService,
		private readonly saveApiKey: (provider: BoldFrontendProvider, baseUrl: string, apiKey: string) => Promise<void>,
		private readonly onDidChange: () => void,
	) {
		super();
		this.container = document.createElement('div');
		this.container.className = 'bold-gateway';
		this.container.setAttribute('aria-hidden', 'true');
		this.container.inert = true;
		const panel = document.createElement('section');
		panel.className = 'bold-gateway__panel';
		const header = document.createElement('header');
		header.className = 'bold-gateway__header';
		const title = document.createElement('strong');
		title.textContent = 'AI Gateway';
		const close = document.createElement('button');
		close.type = 'button';
		close.textContent = '×';
		close.setAttribute('aria-label', '关闭 Gateway');
		close.addEventListener('click', () => void this.close());
		header.append(title, close);
		this.content = document.createElement('div');
		this.content.className = 'bold-gateway__content';
		this.browserHost = document.createElement('div');
		this.browserHost.className = 'bold-gateway__browser-host';
		this.browserHost.hidden = true;
		panel.append(header, this.content, this.browserHost);
		this.container.append(panel);
		document.body.append(this.container);
		this._register(toDisposable(() => this.container.remove()));

		const resizeObserver = new mainWindow.ResizeObserver(() => void this.layoutBrowser());
		resizeObserver.observe(this.browserHost);
		this._register(toDisposable(() => resizeObserver.disconnect()));
		// BrowserViews survive renderer reloads. Remove a stale hidden Gateway page so
		// it cannot cover the custom shell or make an intranet request before the user
		// explicitly opens Gateway.
		this.initialCleanup = this.destroyStaleBrowser();
	}

	async toggle(): Promise<void> {
		if (this.container.classList.contains('is-open')) {
			await this.close();
			return;
		}
		this.container.classList.add('is-open');
		this.container.setAttribute('aria-hidden', 'false');
		this.container.inert = false;
		this.renderMessage('正在连接 Sub2API...', '登录后可在统一设置中为 Claude 和 Codex 分别选择 API。', true);
		try {
			await this.ensureBrowser();
			await this.refreshSession();
		} catch {
			this.renderLogin('无法连接 AI Gateway，请检查网络或稍后重试。');
		}
	}

	async openApiCreation(): Promise<void> {
		this.container.classList.add('is-open');
		this.container.setAttribute('aria-hidden', 'false');
		this.container.inert = false;
		this.renderMessage('正在打开 API 管理…', '可在 Gateway 中创建新的 API。', true);
		await this.ensureBrowser();
		const session = await this.getSession(true);
		if (session.status !== 'authenticated') {
			this.renderLogin(session.message);
			return;
		}
		await this.showPage('/keys', true);
	}

	private async close(): Promise<void> {
		this.container.classList.remove('is-open');
		this.container.setAttribute('aria-hidden', 'true');
		this.container.inert = true;
		this.waitingForKey = false;
		this.managedPageOpen = false;
		await this.setBrowserVisible(false);
	}

	private async ensureBrowser(): Promise<void> {
		await this.initialCleanup;
		if (this.browserCreated) {
			const currentUrl = await this.browserViewService.getURL(GATEWAY_VIEW_ID);
			if (!this.sameOrigin(currentUrl, this.gatewayUrl)) {
				await this.browserViewService.loadURL(GATEWAY_VIEW_ID, this.gatewayUrl);
			}
			return;
		}

		await this.browserViewService.updateWindowConfiguration(this.windowId, {
			theme: { focusBorder: '#5897ff', buttonBackground: '#397ae8', buttonForeground: '#ffffff', font: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif' },
			keybindings: {},
			trustedFileRoots: [],
		});
		await this.browserViewService.getOrCreateBrowserView(GATEWAY_VIEW_ID, {
			owner: { mainWindowId: this.windowId },
			sessionOptions: { scope: BrowserViewStorageScope.Global },
			initialState: { url: this.gatewayUrl, title: 'AI Gateway' },
		});
		this.browserCreated = true;
		this.viewDisposables.add(this.browserViewService.onDynamicDidChangeLoadingState(GATEWAY_VIEW_ID)(event => {
			if (!event.loading && !this.managedPageOpen) {
				void this.refreshSession(true);
			}
		}));
		this.viewDisposables.add(this.browserViewService.onDynamicDidNavigate(GATEWAY_VIEW_ID)(() => {
			if (this.waitingForKey && !this.managedPageOpen) {
				void this.refreshSession(true);
			}
		}));
		const poller = mainWindow.setInterval(() => {
			if (this.waitingForKey) {
				void this.refreshSession(true);
			}
		}, KEY_POLL_INTERVAL);
		this.viewDisposables.add(toDisposable(() => mainWindow.clearInterval(poller)));
		const accountPoller = mainWindow.setInterval(() => void this.refreshSession(true), ACCOUNT_CACHE_TTL);
		this.viewDisposables.add(toDisposable(() => mainWindow.clearInterval(accountPoller)));
	}

	async getAccount(force = false): Promise<IBoldGatewayAccount> {
		const result = await this.getSession(force);
		if (result.status === 'authenticated') {
			return {
				status: 'authenticated',
				accountLabel: result.accountLabel,
				email: result.email,
				balance: result.balance,
				todayUsage: result.todayUsage,
				apiKeys: (result.apiKeys ?? []).map(({ key: _key, ...apiKey }) => apiKey),
				groups: result.groups ?? [],
			};
		}
		return {
			status: result.status === 'signedOut' ? 'signedOut' : 'unavailable',
			apiKeys: [],
			groups: [],
			message: result.message,
		};
	}

	async selectApi(provider: BoldFrontendProvider, apiKeyId: number): Promise<void> {
		const result = await this.getSession(true);
		const apiKey = result.apiKeys?.find(candidate => candidate.id === apiKeyId);
		if (result.status !== 'authenticated' || !apiKey?.key) {
			throw new Error('选择的 Gateway API 不可用');
		}
		if (!this.isCompatible(provider, apiKey.platform, apiKey.allowMessagesDispatch)) {
			throw new Error(`选择的 API 不支持 ${provider === 'claude' ? 'Claude' : 'Codex'}`);
		}
		let baseUrl = result.apiBaseUrl ?? new URL(this.gatewayUrl).origin;
		if (apiKey.platform === 'antigravity') {
			baseUrl = `${baseUrl.replace(/\/$/, '')}/antigravity`;
		}
		await this.saveApiKey(provider, baseUrl, apiKey.key);
	}

	async updateApiGroup(apiKeyId: number, groupId: number): Promise<void> {
		const session = await this.getSession(true);
		if (session.status !== 'authenticated') {
			throw new Error(session.message ?? 'AI Gateway 登录已失效');
		}
		const result = parseResult(await this.browserViewService.executeJavaScript(GATEWAY_VIEW_ID, updateGroupScript(apiKeyId, groupId)));
		if (result?.status !== 'authenticated') {
			throw new Error(result?.message ?? '更新 API 分组失败');
		}
		this.invalidateCache();
		await this.getSession(true);
		this.onDidChange();
	}

	async logout(): Promise<void> {
		await this.ensureBrowser();
		await this.browserViewService.executeJavaScript(GATEWAY_VIEW_ID, LOGOUT_SCRIPT);
		this.cachedResult = { status: 'signedOut' };
		this.cacheTimestamp = Date.now();
		if (this.container.classList.contains('is-open')) {
			this.renderLogin();
		}
		this.onDidChange();
	}

	private async destroyStaleBrowser(): Promise<void> {
		try {
			const stale = (await this.browserViewService.getBrowserViews(this.windowId)).some(view => view.id === GATEWAY_VIEW_ID);
			if (stale) {
				await this.browserViewService.destroyBrowserView(GATEWAY_VIEW_ID);
			}
		} catch {
			// The view may already have been removed with its previous renderer.
		}
	}

	private async getSession(force = false): Promise<IGatewayScriptResult> {
		if (!force && this.cachedResult && Date.now() - this.cacheTimestamp < ACCOUNT_CACHE_TTL) {
			return this.cachedResult;
		}
		if (this.sessionRequest) {
			return this.sessionRequest;
		}
		this.sessionRequest = (async () => {
			try {
				await this.ensureBrowser();
				const url = await this.browserViewService.getURL(GATEWAY_VIEW_ID);
				if (!this.sameOrigin(url, this.gatewayUrl)) {
					return { status: 'error', message: 'Gateway 页面尚未准备好' };
				}
				const result = parseResult(await this.browserViewService.executeJavaScript(GATEWAY_VIEW_ID, SESSION_SCRIPT)) ?? { status: 'error', message: 'Gateway 返回了无效数据' } as const;
				this.cachedResult = result;
				this.cacheTimestamp = Date.now();
				return result;
			} catch (error) {
				const result = { status: 'error', message: error instanceof Error ? error.message : '无法连接 AI Gateway' } as const;
				this.cachedResult = result;
				this.cacheTimestamp = Date.now();
				return result;
			} finally {
				this.sessionRequest = undefined;
			}
		})();
		return this.sessionRequest;
	}

	private async refreshSession(force = false): Promise<void> {
		if (this.requestInProgress) {
			return;
		}
		this.requestInProgress = true;
		const before = this.sessionFingerprint(this.cachedResult);
		try {
			const result = await this.getSession(force);
			if (this.container.classList.contains('is-open') && !this.managedPageOpen) {
				switch (result.status) {
					case 'authenticated': result.apiKeys?.length ? this.renderConnected(result) : this.renderNoKey(); break;
					case 'signedOut': this.renderLogin(); break;
					case 'error': this.renderLogin(result.message); break;
				}
			}
			if (before !== this.sessionFingerprint(result)) {
				this.onDidChange();
			}
		} finally {
			this.requestInProgress = false;
		}
	}

	private renderLogin(message?: string): void {
		void this.setBrowserVisible(false);
		this.waitingForKey = false;
		const card = this.createCard('登录 AI Gateway', '登录后可查看账号用量，并为 Claude 与 Codex 分别选择 API。', message);
		const form = this.document.createElement('form');
		const email = this.createInput('email', '邮箱');
		email.autocomplete = 'username';
		const password = this.createInput('password', '密码');
		password.autocomplete = 'current-password';
		const actions = this.createActions();
		const submit = this.createButton('登录');
		submit.type = 'submit';
		const web = this.createButton('使用网页登录', true);
		actions.append(submit, web);
		form.append(email, password, actions);
		form.addEventListener('submit', event => {
			event.preventDefault();
			void this.login(email.value.trim(), password.value);
		});
		web.addEventListener('click', () => void this.showPage('/login?redirect=/dashboard', true));
		card.append(form);
		this.content.replaceChildren(card);
		mainWindow.setTimeout(() => email.focus(), 0);
	}

	private async login(email: string, password: string): Promise<void> {
		if (!email || !password) {
			this.renderLogin('请输入邮箱和密码。');
			return;
		}
		this.renderMessage('正在登录…', '正在安全连接 Sub2API。', true);
		const result = parseResult(await this.browserViewService.executeJavaScript(GATEWAY_VIEW_ID, loginScript(email, password)));
		if (result?.status === 'twoFactor' && result.tempToken) {
			this.renderTwoFactor(result.tempToken, result.userEmailMasked);
			return;
		}
		if (result?.status === 'authenticated') {
			this.invalidateCache();
			await this.refreshSession(true);
			return;
		}
		this.renderLogin(result?.message ?? '登录失败，请检查账号和密码。');
	}

	private renderTwoFactor(tempToken: string, email?: string, message?: string): void {
		const card = this.createCard('双重验证', email ? `请输入 ${email} 的六位验证码。` : '请输入六位双重验证代码。', message);
		const form = this.document.createElement('form');
		const code = this.createInput('text', '六位验证码');
		code.inputMode = 'numeric';
		code.maxLength = 6;
		const submit = this.createButton('验证并登录');
		submit.type = 'submit';
		form.append(code, submit);
		form.addEventListener('submit', event => {
			event.preventDefault();
			void (async () => {
				const result = parseResult(await this.browserViewService.executeJavaScript(GATEWAY_VIEW_ID, twoFactorScript(tempToken, code.value.trim())));
				if (result?.status === 'authenticated') {
					this.invalidateCache();
					await this.refreshSession(true);
				} else {
					this.renderTwoFactor(tempToken, email, result?.message ?? '验证码错误。');
				}
			})();
		});
		card.append(form);
		this.content.replaceChildren(card);
		mainWindow.setTimeout(() => code.focus(), 0);
	}

	private renderNoKey(): void {
		void this.setBrowserVisible(false);
		this.waitingForKey = false;
		const card = this.createCard('尚未创建 API Key', '账户中没有可用 Key。创建完成后即可在统一设置中分配给扩展。');
		const actions = this.createActions();
		const create = this.createButton('创建 Key');
		const retry = this.createButton('重新检测', true);
		actions.append(create, retry);
		create.addEventListener('click', () => void this.showPage('/keys', true));
		retry.addEventListener('click', () => void this.refreshSession(true));
		card.append(actions);
		this.content.replaceChildren(card);
	}

	private renderConnected(result: IGatewayScriptResult): void {
		void this.setBrowserVisible(false);
		this.waitingForKey = false;
		const card = this.createCard('AI Gateway 已登录', `${result.accountLabel ?? result.email ?? '当前账号'} · ${result.apiKeys?.length ?? 0} 个可用 API`);
		const actions = this.createActions();
		const manage = this.createButton('管理 API', true);
		const close = this.createButton('返回统一设置');
		manage.addEventListener('click', () => void this.showPage('/keys', true));
		close.addEventListener('click', () => void this.close());
		actions.append(close, manage);
		card.append(actions);
		this.content.replaceChildren(card);
	}

	private invalidateCache(): void {
		this.cachedResult = undefined;
		this.cacheTimestamp = 0;
	}

	private isCompatible(provider: BoldFrontendProvider, platform: string | undefined, allowMessagesDispatch: boolean): boolean {
		const resolvedPlatform = platform ?? 'anthropic';
		return provider === 'codex'
			? resolvedPlatform === 'openai'
			: resolvedPlatform === 'anthropic' || resolvedPlatform === 'antigravity' || (resolvedPlatform === 'openai' && allowMessagesDispatch);
	}

	private sessionFingerprint(result: IGatewayScriptResult | undefined): string {
		return JSON.stringify(result ? [result.status, result.accountLabel, result.balance, result.todayUsage, result.apiKeys?.map(key => [key.id, key.groupId])] : []);
	}

	private async showPage(path: string, waitForKey: boolean): Promise<void> {
		this.content.replaceChildren();
		this.browserHost.hidden = false;
		this.waitingForKey = waitForKey;
		// A navigation to /keys previously fired the account refresh callbacks,
		// which immediately replaced the page with the “logged in” card again.
		this.managedPageOpen = true;
		await this.browserViewService.loadURL(GATEWAY_VIEW_ID, new URL(path, this.gatewayUrl).toString());
		await this.setBrowserVisible(true);
		await this.browserViewService.focus(GATEWAY_VIEW_ID);
	}

	private async setBrowserVisible(visible: boolean): Promise<void> {
		this.browserVisible = visible;
		this.browserHost.hidden = !visible;
		if (!this.browserCreated) {
			return;
		}
		if (visible) {
			await this.layoutBrowser();
		}
		await this.browserViewService.setVisible(GATEWAY_VIEW_ID, visible);
	}

	private async layoutBrowser(): Promise<void> {
		if (!this.browserVisible || !this.browserCreated) {
			return;
		}
		const rect = this.browserHost.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) {
			return;
		}
		await this.browserViewService.layout(GATEWAY_VIEW_ID, {
			windowId: this.windowId,
			x: rect.left,
			y: rect.top,
			width: rect.width,
			height: rect.height,
			zoomFactor: getZoomFactor(mainWindow),
			cornerRadius: 12,
		});
	}

	private renderMessage(title: string, description: string, loading = false): void {
		void this.setBrowserVisible(false);
		const card = this.createCard(title, description);
		if (loading) {
			const spinner = this.document.createElement('div');
			spinner.className = 'bold-gateway__spinner';
			card.append(spinner);
		}
		this.content.replaceChildren(card);
	}

	private createCard(title: string, description: string, message?: string): HTMLElement {
		const card = this.document.createElement('div');
		card.className = 'bold-gateway__card';
		const mark = this.document.createElement('span');
		mark.className = 'bold-gateway__mark';
		mark.textContent = 'AI';
		const eyebrow = this.document.createElement('span');
		eyebrow.className = 'bold-gateway__eyebrow';
		eyebrow.textContent = 'SUB2API GATEWAY';
		const heading = this.document.createElement('h2');
		heading.textContent = title;
		const copy = this.document.createElement('p');
		copy.textContent = description;
		card.append(mark, eyebrow, heading, copy);
		if (message) {
			const error = this.document.createElement('div');
			error.className = 'bold-gateway__error';
			error.textContent = message;
			card.append(error);
		}
		return card;
	}

	private createInput(type: string, placeholder: string): HTMLInputElement {
		const input = this.document.createElement('input');
		input.type = type;
		input.placeholder = placeholder;
		input.required = true;
		return input;
	}

	private createButton(label: string, secondary = false): HTMLButtonElement {
		const button = this.document.createElement('button');
		button.type = 'button';
		button.textContent = label;
		button.className = secondary ? 'is-secondary' : '';
		return button;
	}

	private createActions(): HTMLElement {
		const actions = this.document.createElement('div');
		actions.className = 'bold-gateway__actions';
		return actions;
	}

	private sameOrigin(left: string, right: string): boolean {
		try {
			return new URL(left).origin === new URL(right).origin;
		} catch {
			return false;
		}
	}
}
