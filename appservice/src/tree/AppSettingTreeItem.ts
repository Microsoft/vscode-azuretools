/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import WebSiteManagementClient = require('azure-arm-website');
import * as WebSiteModels from 'azure-arm-website/lib/models';
import * as path from 'path';
import * as vscode from 'vscode';
import { SiteWrapper } from 'vscode-azureappservice';
import { IAzureNode, IAzureParentTreeItem, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { nodeUtils } from '../utils/nodeUtils';

export class AppSettingTreeItem implements IAzureTreeItem {
    public static contextValue: string = 'applicationSettingItem';
    public readonly contextValue: string = AppSettingTreeItem.contextValue;

    private key: string;
    private value: string;

    constructor(key: string, value: string) {
        this.key = key;
        this.value = value;
    }

    public get id(): string {
        return this.key;
    }

    public get label(): string {
        return `${this.key}=${this.value}`;
    }

    public get iconPath(): { light: string, dark: string } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', 'resources', 'light', 'Item_16x_vscode.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', 'resources', 'dark', 'Item_16x_vscode.svg')
        };
    }

    public async edit(node: IAzureNode): Promise<void> {
        const newValue = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: `Enter setting value for "${this.key}"`,
            value: this.value
        });

        if (newValue === undefined) {
            return;
        }

        this.value = newValue;
        await (<AppSettingsTreeItem>node.parent.treeItem).editSettingItem(nodeUtils.getWebSiteClient(node), this.key, this.key, newValue);
        node.refresh();
    }

    public async rename(node: IAzureNode): Promise<void> {
        const oldKey = this.key;
        const newKey = await vscode.window.showInputBox({
            ignoreFocusOut: true,
            prompt: `Enter a new name for "${oldKey}"`,
            value: this.key,
            validateInput: v => (<AppSettingsTreeItem>node.parent.treeItem).validateNewKeyInput(v, oldKey)
        });

        if (!newKey) {
            return;
        }

        this.key = newKey;
        await (<AppSettingsTreeItem>node.parent.treeItem).editSettingItem(nodeUtils.getWebSiteClient(node), oldKey, newKey, this.value);
        node.refresh();
    }

    public async deleteTreeItem(node: IAzureNode): Promise<void> {
        const okayAction: vscode.MessageItem = { title: 'Delete' };
        const cancelAction: vscode.MessageItem = { title: 'Cancel', isCloseAffordance: true };
        const result = await vscode.window.showWarningMessage(`Are you sure you want to delete setting "${this.key}"?`, okayAction, cancelAction);

        if (result === okayAction) {
            await (<AppSettingsTreeItem>node.parent.treeItem).deleteSettingItem(nodeUtils.getWebSiteClient(node), this.key);
        } else {
            throw new UserCancelledError();
        }
    }
}
