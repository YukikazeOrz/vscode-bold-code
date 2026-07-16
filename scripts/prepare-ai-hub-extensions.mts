#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Bold Code. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Download the latest AI Hub built-in extensions and write their build manifest.

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

type Extension = { publisher: string; name: string; filename: string; github?: string };
type Download = { version: string; url: string; targetPlatform?: string };
type ExtensionState = { version: string; sha256: string; targetPlatform?: string };
type Manifest = { extensions: Record<string, ExtensionState> };
type GitHubRelease = { tag_name?: string; assets?: Array<{ name: string; browser_download_url?: string }> };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, '.build', 'ai-hub-extensions');
const manifestPath = path.join(destination, 'manifest.json');
const execFile = promisify(execFileCallback);
const extensions: Extension[] = [
	{ publisher: 'Anthropic', name: 'claude-code', filename: 'claude-code.vsix' },
	{ publisher: 'openai', name: 'chatgpt', filename: 'codex.vsix' },
	{ publisher: 'MS-CEINTL', name: 'vscode-language-pack-zh-hans', filename: 'zh-hans.vsix' },
	{ publisher: 'jeanp413', name: 'open-remote-ssh', filename: 'open-remote-ssh.vsix', github: 'jeanp413/open-remote-ssh' },
];

async function latestVersion({ publisher, name, github }: Extension): Promise<Download> {
	if (github) {
		const response = await fetch(`https://api.github.com/repos/${github}/releases/latest`, { headers: { 'Accept': 'application/vnd.github+json' } });
		const release = await response.json() as GitHubRelease;
		const asset = release.assets?.find(asset => asset.name.endsWith('.vsix'));
		if (!response.ok || !asset?.browser_download_url || typeof release.tag_name !== 'string') {
			throw new Error(`GitHub did not return a VSIX release for ${publisher}.${name}.`);
		}
		return { version: release.tag_name.replace(/^v/, ''), url: asset.browser_download_url };
	}

	const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
		method: 'POST',
		headers: { 'Accept': 'application/json;api-version=7.2-preview.1', 'Content-Type': 'application/json' },
		body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: `${publisher}.${name}` }] }], flags: 914 }),
	});
	const body = await response.json() as { results?: Array<{ extensions?: Array<{ versions?: Array<{ version?: string; targetPlatform?: string }> }> }> };
	const targetPlatform = process.platform === 'darwin' ? `darwin-${process.arch}` : `${process.platform}-${process.arch}`;
	const versions = body.results?.[0]?.extensions?.[0]?.versions ?? [];
	const selectedVersion = versions.find(version => version.targetPlatform === targetPlatform) ?? versions.find(version => !version.targetPlatform);
	const version = selectedVersion?.version;
	if (!response.ok || typeof version !== 'string') {
		throw new Error(`Marketplace did not return a version for ${publisher}.${name}.`);
	}
	const platformQuery = selectedVersion?.targetPlatform ? `?targetPlatform=${encodeURIComponent(selectedVersion.targetPlatform)}` : '';
	return {
		version,
		targetPlatform: selectedVersion?.targetPlatform,
		url: `https://${publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${publisher}/extension/${name}/${version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage${platformQuery}`
	};
}

async function checksum(file: string): Promise<string> {
	return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function vsixVersion(file: string): Promise<string> {
	const { stdout } = await execFile('unzip', ['-p', file, 'extension/package.json']);
	return (JSON.parse(stdout) as { version: string }).version;
}

await mkdir(destination, { recursive: true });
const previousManifest: Manifest = await readFile(manifestPath, 'utf8')
	.then(contents => JSON.parse(contents) as Manifest)
	.catch(() => ({ extensions: {} }));
const manifest: Manifest = { extensions: {} };
for (const extension of extensions) {
	const { version, url, targetPlatform } = await latestVersion(extension);
	const target = path.join(destination, extension.filename);
	let hash = await checksum(target).catch(() => undefined);
	const existingVersion = hash ? await vsixVersion(target).catch(() => undefined) : undefined;
	if (existingVersion !== version || previousManifest.extensions[extension.filename]?.targetPlatform !== targetPlatform || previousManifest.extensions[extension.filename]?.sha256 !== hash) {
		console.log(`Downloading AI Hub extension: ${extension.publisher}.${extension.name}@${version}`);
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Unable to download ${extension.publisher}.${extension.name}@${version}: ${response.status} ${response.statusText}`);
		}
		const temporary = `${target}.download`;
		await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
		await rename(temporary, target);
		hash = await checksum(target);
	} else {
		console.log(`AI Hub extension is ready: ${extension.publisher}.${extension.name}@${version}`);
	}
	manifest.extensions[extension.filename] = { version, sha256: hash!, targetPlatform };
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
}
