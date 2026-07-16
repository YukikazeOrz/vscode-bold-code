/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { IEditorService, ACTIVE_GROUP } from '../../../services/editor/common/editorService.js';

/**
 * Opens the AI gateway login/key-management page in VS Code's integrated browser editor.
 * This is a real editor tab backed by BrowserView, not an iframe inside the AI Settings webview.
 */
export async function openAiGateway(browserViewService: IBrowserViewWorkbenchService, editorService: IEditorService, gatewayUrl: string): Promise<void> {
	if (!gatewayUrl) {
		return;
	}

	const input = browserViewService.getOrCreateLazy('ai-gateway', {
		url: gatewayUrl,
		title: 'AI Gateway',
	});
	if (input.url !== gatewayUrl) {
		input.navigate(gatewayUrl);
	}

	await editorService.openEditor(input, { pinned: true, preserveFocus: false }, ACTIVE_GROUP);
}
