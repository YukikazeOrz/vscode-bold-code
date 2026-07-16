/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IAiExtensionHostEnvironmentContributor = createDecorator<IAiExtensionHostEnvironmentContributor>('aiExtensionHostEnvironmentContributor');

/**
 * Lets a higher-level contribution (see contrib/aiHub) inject extra environment
 * variables into freshly spawned extension host processes, e.g. the custom API
 * key env var that a bundled AI extension's provider config points at via its
 * own `env_key`-style setting. Defined at the platform layer purely so
 * extension-host bootstrapping code (a service) is not made to depend on a
 * workbench contribution, which would violate the services/contrib layering.
 */
export interface IAiExtensionHostEnvironmentContributor {
	readonly _serviceBrand: undefined;

	/**
	 * Returns environment variable overrides to mix into a new extension host
	 * process's environment. Values reflect whatever the user has most recently
	 * saved; already-running extension hosts do not pick up later changes.
	 */
	getEnvironmentOverrides(): Promise<Record<string, string>>;
}
