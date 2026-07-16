/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAiHubState } from './aiHubTypes.js';

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

/**
 * Builds the AI Hub webview's HTML. Kept as a single self-contained document (no external
 * resource loading) since the webview's CSP only allows the vscode-webview:// origin;
 * state is passed in as JSON and mutations flow back out via postMessage.
 */
export function buildAiHubHtml(state: IAiHubState): string {
	const nonce = Math.random().toString(36).slice(2);
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 4px 20px 28px; max-width: 720px; }
	h2 { font-size: 15px; font-weight: 600; margin-top: 28px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 8px; display: flex; align-items: center; justify-content: space-between; }
	.card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 16px; margin: 12px 0; }
	.row { display: flex; align-items: center; justify-content: space-between; margin: 10px 0; }
	label { display: block; font-size: 12px; opacity: 0.85; margin-bottom: 4px; }
	input[type=text], input[type=password] { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 6px 8px; margin-bottom: 10px; }
	button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; padding: 6px 14px; cursor: pointer; }
	button:hover { background: var(--vscode-button-hoverBackground); }
	button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
	.hint { font-size: 11px; opacity: 0.7; margin-top: -6px; margin-bottom: 10px; }
	.status { font-size: 12px; margin-left: 8px; opacity: 0.8; }
	.switch { position: relative; display: inline-block; width: 32px; height: 18px; flex-shrink: 0; }
	.switch input { opacity: 0; width: 0; height: 0; }
	.switch .slider { position: absolute; inset: 0; cursor: pointer; background: var(--vscode-input-border); border-radius: 999px; transition: background .15s; }
	.switch .slider::before { content: ""; position: absolute; height: 14px; width: 14px; left: 2px; top: 2px; background: var(--vscode-button-foreground); border-radius: 50%; transition: transform .15s; }
	.switch input:checked + .slider { background: var(--vscode-button-background); }
	.switch input:checked + .slider::before { transform: translateX(14px); }
	.switch input:disabled + .slider { opacity: 0.45; cursor: default; }
	.fields[data-enabled="false"] { display: none; }
	.mode-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 12px 0 18px; }
	.mode-button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-widget-border); min-height: 34px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mode-button[aria-pressed="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
	.agent-note { font-size: 12px; opacity: 0.72; margin: -6px 0 14px; }
</style>
</head>
<body>
	<div class="mode-grid" role="group" aria-label="AI mode">
		<button class="mode-button" data-mode="edit" aria-pressed="${state.mode === 'edit' ? 'true' : 'false'}">编辑模式</button>
		<button class="mode-button" data-mode="claudeAgent" aria-pressed="${state.mode === 'claudeAgent' ? 'true' : 'false'}">Claude Agent</button>
		<button class="mode-button" data-mode="codexAgent" aria-pressed="${state.mode === 'codexAgent' ? 'true' : 'false'}">Codex Agent</button>
	</div>
	<div class="agent-note">${state.mode === 'edit' ? '当前保持完整编辑器布局。' : '当前仅保留所选 Agent 对话。'}</div>

	<h2><span>Claude Code</span><label class="switch"><input type="checkbox" id="claudeEnabled" ${state.claudeEnabled ? 'checked' : ''} ${state.mode === 'edit' ? '' : 'disabled'}><span class="slider"></span></label></h2>
	<div class="card">
		<div class="fields" id="claudeFields" data-enabled="${state.mode === 'claudeAgent' || (state.mode === 'edit' && state.claudeEnabled) ? 'true' : 'false'}">
			<label for="claudeBaseUrl">Base URL</label>
			<input type="text" id="claudeBaseUrl" placeholder="https://..." value="${escapeHtml(state.claudeBaseUrl)}">
			<label for="claudeApiKey">API Key ${state.claudeHasApiKey ? '<span class="status">(already set — leave blank to keep)</span>' : ''}</label>
			<input type="password" id="claudeApiKey" placeholder="${state.claudeHasApiKey ? '••••••••' : 'sk-...'}">
			<button id="saveClaude">Save</button>
		</div>
	</div>

	<h2><span>Codex</span><label class="switch"><input type="checkbox" id="codexEnabled" ${state.codexEnabled ? 'checked' : ''} ${state.mode === 'edit' ? '' : 'disabled'}><span class="slider"></span></label></h2>
	<div class="card">
		<div class="fields" id="codexFields" data-enabled="${state.mode === 'codexAgent' || (state.mode === 'edit' && state.codexEnabled) ? 'true' : 'false'}">
			<label for="codexBaseUrl">Base URL</label>
			<input type="text" id="codexBaseUrl" placeholder="https://..." value="${escapeHtml(state.codexBaseUrl)}">
			<label for="codexApiKey">API Key ${state.codexHasApiKey ? '<span class="status">(already set — leave blank to keep)</span>' : ''}</label>
			<input type="password" id="codexApiKey" placeholder="${state.codexHasApiKey ? '••••••••' : 'sk-...'}">
			<div class="hint">Codex reads this key at extension-host startup; changing it takes effect after reloading the window.</div>
			<button id="saveCodex">Save</button>
		</div>
	</div>

	<h2>编辑器设置</h2>
	<div class="card">
		<p style="margin-top:0">打开原始的 VS Code 编辑器设置界面。</p>
		<button id="openEditorSettings" class="secondary">打开编辑器设置</button>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const $ = id => document.getElementById(id);
		const currentMode = '${state.mode}';

		document.querySelectorAll('[data-mode]').forEach(button => {
			button.addEventListener('click', () => {
				const mode = button.dataset.mode;
				if (mode && mode !== currentMode) {
					vscode.postMessage({ type: 'setMode', mode });
				}
			});
		});

		$('claudeEnabled').addEventListener('change', e => {
			$('claudeFields').dataset.enabled = e.target.checked ? 'true' : 'false';
			vscode.postMessage({ type: 'toggleExtension', id: 'claude', enabled: e.target.checked });
		});
		$('codexEnabled').addEventListener('change', e => {
			$('codexFields').dataset.enabled = e.target.checked ? 'true' : 'false';
			vscode.postMessage({ type: 'toggleExtension', id: 'codex', enabled: e.target.checked });
		});

		$('saveClaude').addEventListener('click', () => vscode.postMessage({
			type: 'save', provider: 'claude',
			baseUrl: $('claudeBaseUrl').value, apiKey: $('claudeApiKey').value
		}));
		$('saveCodex').addEventListener('click', () => vscode.postMessage({
			type: 'save', provider: 'codex',
			baseUrl: $('codexBaseUrl').value, apiKey: $('codexApiKey').value
		}));
		$('openEditorSettings').addEventListener('click', () => vscode.postMessage({ type: 'openEditorSettings' }));

		window.addEventListener('message', event => {
			const message = event.data;
			if (message.type === 'importedKey') {
				const target = message.provider === 'claude' ? 'claudeApiKey' : 'codexApiKey';
				$(target).value = message.apiKey;
				$(target).placeholder = 'imported — click Save to apply';
			}
		});
	</script>
</body>
</html>`;
}
