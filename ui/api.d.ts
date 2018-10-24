/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// For now this file needs to be copied/pasted into your repo if you want the types. Eventually we may put it somewhere more distributable.

export interface AzureExtension {
    /**
     * The API version for this extension. It should be versioned separately from the extension and ideally remains backwards compatible.
     */
    apiVersion: string;
}

export interface AzureExtensionProvider {
    /**
     * Provides the API for an Azure Extension.
     *
     * @param apiVersion The version of the API you need. Any semver syntax is allowed. For example "1" will return any "1.x.x" version or "1.2" will return any "1.2.x" version
     * @throws Error if a matching version is not found.
     */
    getExtension<T extends AzureExtension>(apiVersion: string): Promise<T>;
}
