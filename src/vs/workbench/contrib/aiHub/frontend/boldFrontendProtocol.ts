/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type BoldFrontendMode = 'edit' | 'claudeAgent' | 'codexAgent';
export type BoldFrontendProvider = 'claude' | 'codex';

export type BoldFrontendAction = 'newFile' | 'terminal';

export interface IBoldFrontendFileEntry {
	readonly name: string;
	readonly uri: string;
	readonly directory: boolean;
}

export interface IBoldFrontendTab {
	readonly id: string;
	readonly label: string;
	readonly active: boolean;
	readonly dirty: boolean;
}

export interface IBoldFrontendDocument {
	readonly uri: string;
	readonly name: string;
	readonly languageId: string;
	readonly contents: string;
}

export interface IBoldFrontendSearchMatch {
	readonly line: number;
	readonly preview: string;
}

export interface IBoldFrontendSearchResult {
	readonly uri: string;
	readonly name: string;
	readonly path: string;
	readonly matches: readonly IBoldFrontendSearchMatch[];
}

export interface IBoldFrontendSSHHost {
	readonly alias: string;
	readonly destination?: string;
	readonly detail?: string;
}

export type BoldGatewayStatus = 'authenticated' | 'signedOut' | 'unavailable';

export interface IBoldGatewayGroup {
	readonly id: number;
	readonly name: string;
	readonly platform: string;
	readonly description?: string;
	readonly allowMessagesDispatch: boolean;
}

export interface IBoldGatewayApiKey {
	readonly id: number;
	readonly name: string;
	readonly maskedKey: string;
	readonly status: string;
	readonly groupId?: number;
	readonly groupName?: string;
	readonly platform?: string;
	readonly allowMessagesDispatch: boolean;
}

export interface IBoldGatewayAccount {
	readonly status: BoldGatewayStatus;
	readonly accountLabel?: string;
	readonly email?: string;
	readonly balance?: number;
	readonly todayUsage?: number;
	readonly apiKeys: readonly IBoldGatewayApiKey[];
	readonly groups: readonly IBoldGatewayGroup[];
	readonly message?: string;
}

export interface IBoldFrontendAiSettings {
	readonly claudeBaseUrl: string;
	readonly claudeHasApiKey: boolean;
	readonly codexBaseUrl: string;
	readonly codexHasApiKey: boolean;
	readonly editChatProvider: BoldFrontendProvider;
	readonly claudeGatewayApiKeyId?: number;
	readonly codexGatewayApiKeyId?: number;
	readonly gateway: IBoldGatewayAccount;
}

export interface IBoldFrontendState {
	readonly mode: BoldFrontendMode;
	readonly workspaceName: string;
	readonly workspaceRoots: readonly IBoldFrontendFileEntry[];
	readonly tabs: readonly IBoldFrontendTab[];
	readonly claudeEnabled: boolean;
	readonly codexEnabled: boolean;
	readonly gatewayStatus: BoldGatewayStatus;
	readonly gatewayBalance?: number;
	readonly gatewayTodayUsage?: number;
	readonly editChatProvider: BoldFrontendProvider;
	readonly searchActive: boolean;
	readonly terminalActive: boolean;
}

/**
 * The frontend's complete privileged boundary. Implementations may use VS Code today and a
 * standalone backend later, while this UI remains unchanged.
 */
export interface IBoldFrontendBridge {
	getState(): Promise<IBoldFrontendState>;
	listDirectory(uri: string): Promise<readonly IBoldFrontendFileEntry[]>;
	searchWorkspace(query: string): Promise<readonly IBoldFrontendSearchResult[]>;
	listSSHHosts(): Promise<readonly IBoldFrontendSSHHost[]>;
	connectSSHHost(host: string): Promise<void>;
	openSSHConfig(): Promise<void>;
	openFile(uri: string): Promise<IBoldFrontendDocument>;
	saveFile(uri: string, contents: string): Promise<void>;
	runAction(action: BoldFrontendAction): Promise<void>;
	toggleSearch(): Promise<void>;
	setMode(mode: BoldFrontendMode): Promise<void>;
	setEditChatProvider(provider: BoldFrontendProvider): Promise<void>;
	getAiSettings(): Promise<IBoldFrontendAiSettings>;
	saveAiSettings(provider: 'claude' | 'codex', baseUrl: string, apiKey: string): Promise<void>;
	checkForExtensionUpdate(provider: BoldFrontendProvider): Promise<boolean>;
	selectGatewayApi(provider: BoldFrontendProvider, apiKeyId: number): Promise<void>;
	updateGatewayApiGroup(apiKeyId: number, groupId: number): Promise<void>;
	openGatewayApiCreation(): Promise<void>;
	logoutGateway(): Promise<void>;
	openGateway(): Promise<void>;
	openSettings(): Promise<void>;
	subscribe(listener: (state: IBoldFrontendState) => void): () => void;
}
