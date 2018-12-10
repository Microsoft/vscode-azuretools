/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringDictionary } from 'azure-arm-website/lib/models';
import * as path from 'path';
import { AzureParentTreeItem, AzureTreeItem } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { AppSettingTreeItem } from './AppSettingTreeItem';
import { ISiteTreeRoot } from './ISiteTreeRoot';

export function validateAppSettingKey(settings: StringDictionary, newKey?: string, oldKey?: string): string | undefined {
    newKey = newKey ? newKey.trim() : '';
    oldKey = oldKey ? oldKey.trim().toLowerCase() : oldKey;
    if (newKey.length === 0) {
        return 'Key must have at least one non-whitespace character.';
    }
    if (settings.properties && newKey.toLowerCase() !== oldKey) {
        for (const key of Object.keys(settings.properties)) {
            if (key.toLowerCase() === newKey.toLowerCase()) {
                return `Setting "${newKey}" already exists.`;
            }
        }
    }

    return undefined;
}

export class AppSettingsTreeItem extends AzureParentTreeItem<ISiteTreeRoot> {
    public static contextValue: string = 'applicationSettings';
    public readonly label: string = 'Application Settings';
    public readonly childTypeLabel: string = 'App Setting';
    public readonly contextValue: string = AppSettingsTreeItem.contextValue;
    private _settings: StringDictionary | undefined;

    constructor(parent: AzureParentTreeItem) {
        super(parent);
    }

    public get id(): string {
        return 'application';
    }

    public get iconPath(): { light: string, dark: string } {
        return {
            light: path.join(__filename, '..', '..', '..', 'resources', 'light', 'AppSettings_color.svg'),
            dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'AppSettings_color.svg')
        };
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<ISiteTreeRoot>[]> {
        this._settings = await this.root.client.listApplicationSettings();
        const treeItems: AppSettingTreeItem[] = [];
        // tslint:disable-next-line:strict-boolean-expressions
        const properties: { [name: string]: string } = this._settings.properties || {};
        Object.keys(properties).forEach((key: string) => {
            treeItems.push(new AppSettingTreeItem(this, key, properties[key]));
        });

        return treeItems;
    }

    public async editSettingItem(oldKey: string, newKey: string, value: string): Promise<void> {
        const settings: StringDictionary = await this.ensureSettings();

        if (settings.properties) {
            if (oldKey !== newKey) {
                delete settings.properties[oldKey];
            }
            settings.properties[newKey] = value;
        }

        await this.root.client.updateApplicationSettings(settings);
    }

    public async deleteSettingItem(key: string): Promise<void> {
        const settings: StringDictionary = await this.ensureSettings();

        if (settings.properties) {
            delete settings.properties[key];
        }

        await this.root.client.updateApplicationSettings(settings);
    }

    public async createChildImpl(showCreatingTreeItem: (label: string) => void): Promise<AzureTreeItem<ISiteTreeRoot>> {
        const settings: StringDictionary = await this.ensureSettings();

        const newKey: string = await ext.ui.showInputBox({
            prompt: 'Enter new setting key',
            validateInput: (v?: string): string | undefined => validateAppSettingKey(settings, v)
        });

        const newValue: string = await ext.ui.showInputBox({
            prompt: `Enter setting value for "${newKey}"`
        });

        if (!settings.properties) {
            settings.properties = {};
        }

        showCreatingTreeItem(newKey);
        settings.properties[newKey] = newValue;
        await this.root.client.updateApplicationSettings(settings);
        return new AppSettingTreeItem(this, newKey, newValue);
    }

    public async ensureSettings(): Promise<StringDictionary> {
        if (!this._settings) {
            await this.getCachedChildren();
        }

        return <StringDictionary>this._settings;
    }
}
