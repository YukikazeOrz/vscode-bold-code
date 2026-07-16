/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const CLAUDE_EXTENSION_ID = 'Anthropic.claude-code';
export const CODEX_EXTENSION_ID = 'openai.chatgpt';

export const AI_HUB_OPEN_COMMAND_ID = 'aiHub.open';
export const AI_GATEWAY_OPEN_COMMAND_ID = 'aiGateway.open';

export const AI_HUB_AGENT_MODE_CLASS = 'ai-hub-agent-mode';
export const AI_HUB_EDIT_CHAT_MODE_CLASS = 'ai-hub-edit-chat-mode';
export const AI_HUB_AGENT_LOADING_CLASS = 'ai-hub-agent-loading';
export const BOLD_FRONTEND_BOOTSTRAP_CLASS = 'bold-frontend-bootstrapping';
export const BOLD_FRONTEND_ACTIVE_CLASS = 'bold-independent-frontend';

/** Env var name Codex's custom `model_providers.<id>.env_key` points at. */
export const CODEX_PROVIDER_ID = 'ai-hub-gateway';
export const CODEX_ENV_KEY = 'CODEX_AI_HUB_API_KEY';

export type AiHubMode = 'edit' | 'claudeAgent' | 'codexAgent';
export type AiHubProvider = 'claude' | 'codex';

export interface IAiProviderSettings {
	readonly baseUrl: string;
	/** Never round-tripped back to the webview once saved; write-only from the service's perspective. */
	readonly apiKey: string;
}

export interface IAiHubState {
	readonly claudeBaseUrl: string;
	readonly claudeHasApiKey: boolean;
	readonly codexBaseUrl: string;
	readonly codexHasApiKey: boolean;
	readonly claudeEnabled: boolean;
	readonly codexEnabled: boolean;
	readonly mode: AiHubMode;
	readonly editChatProvider: AiHubProvider;
	readonly gatewayUrl: string;
}

export const IAiConfigService = createDecorator<IAiConfigService>('aiConfigService');

export const IAiHubModeController = createDecorator<IAiHubModeController>('aiHubModeController');

export interface IAiHubModeController {
	readonly _serviceBrand: undefined;
	readonly mode: AiHubMode;

	initialize(): Promise<void>;
	setMode(mode: AiHubMode): Promise<void>;
	setEditChatProvider(provider: AiHubProvider): Promise<void>;
	setEnforcementSuspended(suspended: boolean): void;
}

export interface IAiConfigService {
	readonly _serviceBrand: undefined;

	/**
	 * Reads current base URLs and whether keys are set (never returns the keys themselves)
	 * plus current enablement of the two bundled extensions, for populating the AI Hub UI.
	 */
	getState(): Promise<IAiHubState>;

	/**
	 * Switches the top-level experience mode. Both bundled extensions remain resident;
	 * the mode controls whether the editor/chat split or one full Agent surface is shown.
	 */
	setMode(mode: AiHubMode): Promise<void>;

	/** Persists which bundled extension is shown beside the editor in Edit mode. */
	setEditChatProvider(provider: AiHubProvider): Promise<void>;

	/** Writes `~/.claude/settings.json`'s `env` block, preserving unrelated existing keys. */
	saveClaudeSettings(settings: IAiProviderSettings): Promise<void>;

	/**
	 * Writes `~/.codex/config.toml` (custom model_provider pointing at settings.baseUrl) and
	 * `~/.codex/auth.json` (apikey auth mode), preserving unrelated existing keys/tables.
	 */
	saveCodexSettings(settings: IAiProviderSettings): Promise<void>;

	/** Enables/disables one of the two bundled AI extensions by id. */
	setExtensionEnabled(id: string, enabled: boolean): Promise<void>;

	/** Checks the selected bundled AI extension and installs its latest Marketplace update. */
	checkForExtensionUpdate(provider: AiHubProvider): Promise<boolean>;
}
