/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeItemCollapsibleState, Uri } from 'vscode';
import { ISubscriptionRoot, OpenInPortalOptions } from '../..';
import * as types from '../..';
import { ArgumentError, NotImplementedError } from '../errors';
import { localize } from '../localize';
import { openUrl } from '../utils/openUrl';
import { treeUtils } from '../utils/treeUtils';
import { IAzureParentTreeItemInternal, IAzureTreeDataProviderInternal } from "./InternalInterfaces";

export abstract class AzureTreeItem<TRoot = ISubscriptionRoot> implements types.AzureTreeItem<TRoot> {
    //#region Properties implemented by base class
    public abstract label: string;
    public abstract contextValue: string;
    public description?: string;
    public id?: string;
    public commandId?: string;
    public iconPath?: string | Uri | { light: string | Uri; dark: string | Uri };
    //#endregion

    public readonly collapsibleState: TreeItemCollapsibleState | undefined;
    public readonly parent: IAzureParentTreeItemInternal<TRoot> | undefined;
    private _temporaryDescription?: string;

    public constructor(parent: IAzureParentTreeItemInternal<TRoot> | undefined) {
        this.parent = parent;
    }

    private get _effectiveDescription(): string | undefined {
        return this._temporaryDescription || this.description;
    }

    public get fullId(): string {
        let id: string = this.id || this.label;
        if (!id.startsWith('/')) {
            id = `/${id}`;
        }

        // For the sake of backwards compat, only add the parent's id if it's not already there
        if (this.parent && !id.startsWith(this.parent.fullId)) {
            id = `${this.parent.fullId}${id}`;
        }

        return id;
    }

    public get effectiveIconPath(): string | Uri | { light: string | Uri; dark: string | Uri } | undefined {
        return this._temporaryDescription ? treeUtils.getThemedIconPath('Loading') : this.iconPath;
    }

    public get effectiveLabel(): string {
        return this._effectiveDescription ? `${this.label} (${this._effectiveDescription})` : this.label;

    }

    public get root(): TRoot {
        if (this.parent) {
            return this.parent.root;
        } else {
            throw new ArgumentError(this);
        }
    }

    public get treeDataProvider(): IAzureTreeDataProviderInternal<TRoot> {
        if (this.parent) {
            return this.parent.treeDataProvider;
        } else {
            throw new ArgumentError(this);
        }
    }

    //#region Methods implemented by base class
    public refreshImpl?(): Promise<void>;
    public isAncestorOfImpl?(contextValue: string | RegExp): boolean;
    public deleteTreeItemImpl?(): Promise<void>;
    //#endregion

    public async refresh(): Promise<void> {
        await this.treeDataProvider.refresh(this);
    }

    public async openInPortal(this: AzureTreeItem<ISubscriptionRoot>, id?: string, options?: OpenInPortalOptions): Promise<void> {
        id = id === undefined ? this.fullId : id;
        const queryPrefix: string = (options && options.queryPrefix) ? `?${options.queryPrefix}` : '';
        const url: string = `${this.root.environment.portalUrl}/${queryPrefix}#@${this.root.tenantId}/resource${id}`;

        await openUrl(url);
    }

    public includeInTreePicker(expectedContextValues: (string | RegExp)[]): boolean {
        return expectedContextValues.some((val: string | RegExp) => {
            return this.contextValue === val ||
                (val instanceof RegExp && val.test(this.contextValue)) ||
                !this.isAncestorOfImpl ||
                this.isAncestorOfImpl(val);
        });
    }

    public async deleteTreeItem(): Promise<void> {
        await this.runWithTemporaryDescription(localize('deleting', 'Deleting...'), async () => {
            if (this.deleteTreeItemImpl) {
                await this.deleteTreeItemImpl();
                if (this.parent) {
                    this.parent.removeChildFromCache(this);
                }
            } else {
                throw new NotImplementedError('deleteTreeItemImpl', this);
            }
        });
    }

    public async runWithTemporaryDescription(description: string, callback: () => Promise<void>): Promise<void> {
        this._temporaryDescription = description;
        try {
            this.treeDataProvider.refreshUIOnly(this);
            await callback();
        } finally {
            this._temporaryDescription = undefined;
            await this.refresh();
        }
    }
}
