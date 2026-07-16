/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { INativeEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IAiExtensionHostEnvironmentContributor } from '../../../../platform/environment/common/aiExtensionHostEnvironment.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { areSameExtensions } from '../../../../platform/extensionManagement/common/extensionManagementUtil.js';
import { EnablementState, IWorkbenchExtensionEnablementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import {
	CLAUDE_EXTENSION_ID, CODEX_ENV_KEY, CODEX_PROVIDER_ID, CODEX_EXTENSION_ID,
	AiHubMode, AiHubProvider, IAiConfigService, IAiHubState, IAiProviderSettings
} from './aiHubTypes.js';

const AI_HUB_MODE_STORAGE_KEY = 'aiHub.mode';
const AI_HUB_EDIT_CHAT_PROVIDER_STORAGE_KEY = 'aiHub.editChatProvider';

export class AiConfigService implements IAiConfigService, IAiExtensionHostEnvironmentContributor {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IProductService private readonly productService: IProductService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) { }

	private get claudeSettingsUri(): URI {
		return URI.joinPath(this.environmentService.userHome, '.claude', 'settings.json');
	}

	private get codexConfigTomlUri(): URI {
		return URI.joinPath(this.environmentService.userHome, '.codex', 'config.toml');
	}

	private get codexAuthJsonUri(): URI {
		return URI.joinPath(this.environmentService.userHome, '.codex', 'auth.json');
	}

	private async readJsonIfExists(uri: URI): Promise<any> {
		try {
			const content = await this.fileService.readFile(uri);
			return JSON.parse(content.value.toString());
		} catch {
			return {};
		}
	}

	private async readJsonForUpdate(uri: URI): Promise<Record<string, any>> {
		let contents: string;
		try {
			contents = (await this.fileService.readFile(uri)).value.toString();
		} catch (error) {
			if (toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
				return {};
			}
			throw error;
		}
		const parsed = JSON.parse(contents);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			throw new Error(`Cannot update non-object JSON configuration: ${uri.toString()}`);
		}
		return parsed;
	}

	private async readTextForUpdate(uri: URI): Promise<string> {
		try {
			return (await this.fileService.readFile(uri)).value.toString();
		} catch (error) {
			if (toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
				return '';
			}
			throw error;
		}
	}

	private async readTextIfExists(uri: URI): Promise<string> {
		try {
			const content = await this.fileService.readFile(uri);
			return content.value.toString();
		} catch {
			return '';
		}
	}

	private async writeFile(uri: URI, contents: string): Promise<void> {
		await this.fileService.writeFile(uri, VSBuffer.fromString(contents), { atomic: { postfix: '.aiHub-tmp' } });
	}

	private findExtension(id: string) {
		return this.extensionsWorkbenchService.local.find(e => areSameExtensions(e.identifier, { id }));
	}

	private getMode(): AiHubMode {
		const mode = this.storageService.get(AI_HUB_MODE_STORAGE_KEY, StorageScope.PROFILE, 'claudeAgent');
		return mode === 'codexAgent' ? mode : 'claudeAgent';
	}

	private getEditChatProvider(): AiHubProvider {
		const provider = this.storageService.get(AI_HUB_EDIT_CHAT_PROVIDER_STORAGE_KEY, StorageScope.PROFILE);
		if (provider === 'claude' || provider === 'codex') {
			return provider;
		}

		// Preserve the user's last focused Agent as the initial split-view choice when
		// migrating profiles that predate the dedicated editor-chat preference.
		return this.getMode() === 'codexAgent' ? 'codex' : 'claude';
	}

	async getState(): Promise<IAiHubState> {
		const [claudeSettings, codexToml, codexAuth] = await Promise.all([
			this.readJsonIfExists(this.claudeSettingsUri),
			this.readTextIfExists(this.codexConfigTomlUri),
			this.readJsonIfExists(this.codexAuthJsonUri),
			this.extensionsWorkbenchService.whenInitialized,
		]);

		const claudeEnv = claudeSettings?.env ?? {};
		const codexBaseUrlMatch = new RegExp(`\\[model_providers\\.${CODEX_PROVIDER_ID}\\][^[]*base_url\\s*=\\s*"([^"]*)"`).exec(codexToml);

		const claudeExt = this.findExtension(CLAUDE_EXTENSION_ID);
		const codexExt = this.findExtension(CODEX_EXTENSION_ID);

		return {
			claudeBaseUrl: claudeEnv.ANTHROPIC_BASE_URL ?? '',
			claudeHasApiKey: !!claudeEnv.ANTHROPIC_AUTH_TOKEN,
			codexBaseUrl: codexBaseUrlMatch?.[1] ?? '',
			codexHasApiKey: !!codexAuth?.OPENAI_API_KEY,
			claudeEnabled: !!claudeExt?.local && this.extensionEnablementService.isEnabled(claudeExt.local),
			codexEnabled: !!codexExt?.local && this.extensionEnablementService.isEnabled(codexExt.local),
			mode: this.getMode(),
			editChatProvider: this.getEditChatProvider(),
			gatewayUrl: this.productService.aiGatewayUrl ?? '',
		};
	}

	async setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
		const extension = this.findExtension(id);
		if (!extension) {
			this.logService.warn(`[aiHub] cannot toggle unknown extension ${id}`);
			return;
		}
		if (!!extension.local && this.extensionEnablementService.isEnabled(extension.local) === enabled) {
			return;
		}
		await this.extensionsWorkbenchService.setEnablement(extension, enabled ? EnablementState.EnabledGlobally : EnablementState.DisabledGlobally);
	}

	async checkForExtensionUpdate(provider: AiHubProvider): Promise<boolean> {
		await this.extensionsWorkbenchService.whenInitialized;
		await this.extensionsWorkbenchService.checkForUpdates();

		const extension = this.findExtension(provider === 'claude' ? CLAUDE_EXTENSION_ID : CODEX_EXTENSION_ID);
		if (!extension) {
			throw new Error(`${provider === 'claude' ? 'Claude Code' : 'Codex'} extension is not installed.`);
		}
		if (!extension.outdated) {
			return false;
		}
		const canInstall = await this.extensionsWorkbenchService.canInstall(extension);
		if (canInstall !== true) {
			throw new Error(`${provider === 'claude' ? 'Claude Code' : 'Codex'} update is unavailable.`);
		}
		await this.extensionsWorkbenchService.install(extension, {
			installPreReleaseVersion: !!extension.local?.preRelease,
		});
		return true;
	}

	async setMode(mode: AiHubMode): Promise<void> {
		this.storageService.store(AI_HUB_MODE_STORAGE_KEY, mode, StorageScope.PROFILE, StorageTarget.USER);
	}

	async setEditChatProvider(provider: AiHubProvider): Promise<void> {
		this.storageService.store(AI_HUB_EDIT_CHAT_PROVIDER_STORAGE_KEY, provider, StorageScope.PROFILE, StorageTarget.USER);
	}

	async saveClaudeSettings(settings: IAiProviderSettings): Promise<void> {
		const uri = this.claudeSettingsUri;
		const json = await this.readJsonForUpdate(uri);
		if (json.env !== undefined && (!json.env || typeof json.env !== 'object' || Array.isArray(json.env))) {
			throw new Error(`Cannot update non-object env configuration: ${uri.toString()}`);
		}
		json.env = {
			...json.env,
			ANTHROPIC_BASE_URL: settings.baseUrl,
			ANTHROPIC_AUTH_TOKEN: settings.apiKey,
		};
		await this.writeFile(uri, JSON.stringify(json, null, 2) + '\n');
	}

	async saveCodexSettings(settings: IAiProviderSettings): Promise<void> {
		await Promise.all([
			this.writeCodexConfigToml(settings.baseUrl),
			this.writeCodexAuthJson(settings.apiKey),
		]);
	}

	private async writeCodexConfigToml(baseUrl: string): Promise<void> {
		const uri = this.codexConfigTomlUri;
		const existing = await this.readTextForUpdate(uri);
		await this.writeFile(uri, mergeCodexConfigToml(existing, baseUrl));
	}

	private async writeCodexAuthJson(apiKey: string): Promise<void> {
		const uri = this.codexAuthJsonUri;
		const json = await this.readJsonForUpdate(uri);
		json.auth_mode = 'apikey';
		json.OPENAI_API_KEY = apiKey;
		await this.writeFile(uri, JSON.stringify(json, null, 2) + '\n');
	}

	async getEnvironmentOverrides(): Promise<Record<string, string>> {
		try {
			const auth = await this.readJsonIfExists(this.codexAuthJsonUri);
			if (auth?.OPENAI_API_KEY) {
				return { [CODEX_ENV_KEY]: auth.OPENAI_API_KEY };
			}
		} catch (err) {
			this.logService.warn('[aiHub] failed to read codex auth.json for env override', err);
		}
		return {};
	}
}

/**
 * Text-level merge for `~/.codex/config.toml`: owns exactly the top-level `model_provider`
 * directive and its own `[model_providers.ai-hub-gateway]` table, leaving everything else in
 * the file untouched. No TOML library is bundled with VS Code, and the shape we need to write
 * is narrow enough that a targeted text merge is safer than adding a new dependency.
 */
export function mergeCodexConfigToml(existing: string, baseUrl: string): string {
	const eol = existing.includes('\r\n') ? '\r\n' : '\n';
	const lines = existing.length ? existing.replace(/\r?\n$/, '').split(/\r?\n/) : [];

	const sectionHeaderIndex = lines.findIndex(l => /^\s*\[/.test(l));
	const preambleEnd = sectionHeaderIndex === -1 ? lines.length : sectionHeaderIndex;
	const preamble = lines.slice(0, preambleEnd);
	const rest = lines.slice(preambleEnd);

	const providerLineIndex = preamble.findIndex(l => /^\s*model_provider\s*=/.test(l));
	const providerLine = `model_provider = "${CODEX_PROVIDER_ID}"`;
	if (providerLineIndex === -1) {
		preamble.push(providerLine);
	} else {
		preamble[providerLineIndex] = providerLine;
	}

	const ourHeader = `[model_providers.${CODEX_PROVIDER_ID}]`;
	const requiredProviderFields: ReadonlyArray<readonly [string, string]> = [
		['name', 'name = "AI Hub Gateway"'],
		['base_url', `base_url = ${JSON.stringify(baseUrl)}`],
		['env_key', `env_key = "${CODEX_ENV_KEY}"`],
		['wire_api', 'wire_api = "responses"'],
	];
	const ourBlock = [
		ourHeader,
		...requiredProviderFields.map(([, line]) => line),
	];

	const ourHeaderIndex = rest.findIndex(l => l.trim() === ourHeader);
	if (ourHeaderIndex === -1) {
		const merged = [...preamble];
		if (merged.length && merged[merged.length - 1] !== '') {
			merged.push('');
		}
		merged.push(...rest);
		if (merged.length && merged[merged.length - 1] !== '') {
			merged.push('');
		}
		merged.push(...ourBlock);
		return merged.join(eol) + eol;
	}

	let ourBlockEnd = rest.findIndex((l, i) => i > ourHeaderIndex && /^\s*\[/.test(l));
	if (ourBlockEnd === -1) {
		ourBlockEnd = rest.length;
	}
	const existingBlock = rest.slice(ourHeaderIndex, ourBlockEnd);
	const updatedBlock = [...existingBlock];
	for (const [key, replacement] of requiredProviderFields) {
		const keyPattern = new RegExp(`^\\s*${key}\\s*=`);
		const keyIndex = updatedBlock.findIndex(line => keyPattern.test(line));
		if (keyIndex === -1) {
			updatedBlock.push(replacement);
		} else if (key === 'base_url' || key === 'env_key' || key === 'wire_api') {
			updatedBlock[keyIndex] = replacement;
		}
	}
	const newRest = [...rest.slice(0, ourHeaderIndex), ...updatedBlock, ...rest.slice(ourBlockEnd)];
	return [...preamble, ...newRest].join(eol) + eol;
}
