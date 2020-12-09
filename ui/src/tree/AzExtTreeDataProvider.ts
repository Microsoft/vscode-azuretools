/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, Event, EventEmitter, TreeItem } from 'vscode';
import * as types from '../../index';
import { callWithTelemetryAndErrorHandling } from '../callWithTelemetryAndErrorHandling';
import { NoResourceFoundError, UserCancelledError } from '../errors';
import { localize } from '../localize';
import { addValuesToMaskFromAzureId } from '../masking';
import { parseError } from '../parseError';
import { AzExtParentTreeItem, InvalidTreeItem } from './AzExtParentTreeItem';
import { AzExtTreeItem } from './AzExtTreeItem';
import { GenericTreeItem } from './GenericTreeItem';
import { getThemedIconPath } from './IconPath';
import { IAzExtTreeDataProviderInternal, isAzExtParentTreeItem } from './InternalInterfaces';
import { runWithLoadingNotification } from './runWithLoadingNotification';
import { loadMoreLabel } from './treeConstants';

export class AzExtTreeDataProvider implements IAzExtTreeDataProviderInternal, types.AzExtTreeDataProvider {
    public _onTreeItemCreateEmitter: EventEmitter<AzExtTreeItem> = new EventEmitter<AzExtTreeItem>();
    private _onDidChangeTreeDataEmitter: EventEmitter<AzExtTreeItem | undefined> = new EventEmitter<AzExtTreeItem | undefined>();

    private readonly _loadMoreCommandId: string;
    private readonly _rootTreeItem: AzExtParentTreeItem;
    private readonly _findTreeItemTasks: Map<string, Promise<types.AzExtTreeItem | undefined>> = new Map();

    constructor(rootTreeItem: AzExtParentTreeItem, loadMoreCommandId: string) {
        this._loadMoreCommandId = loadMoreCommandId;
        this._rootTreeItem = rootTreeItem;
        rootTreeItem.treeDataProvider = <IAzExtTreeDataProviderInternal>this;
    }

    public get onDidChangeTreeData(): Event<AzExtTreeItem | undefined> {
        return this._onDidChangeTreeDataEmitter.event;
    }

    public get onTreeItemCreate(): Event<AzExtTreeItem> {
        return this._onTreeItemCreateEmitter.event;
    }

    public getTreeItem(treeItem: AzExtTreeItem & { uniqueFullId?: string }): TreeItem {
        return {
            label: treeItem.label,
            description: treeItem.effectiveDescription,
            id: treeItem.uniqueFullId || treeItem.fullId,
            collapsibleState: treeItem.collapsibleState,
            contextValue: treeItem.contextValue,
            iconPath: treeItem.effectiveIconPath,
            command: treeItem.commandId ? {
                command: treeItem.commandId,
                title: '',
                // tslint:disable-next-line: strict-boolean-expressions
                arguments: treeItem.commandArgs || [treeItem]
            } : undefined
        };
    }

    public async getChildren(arg?: AzExtParentTreeItem): Promise<(AzExtTreeItem & { uniqueFullId?: string })[]> {
        try {
            return <AzExtTreeItem[]>await callWithTelemetryAndErrorHandling('AzureTreeDataProvider.getChildren', async (context: types.IActionContext) => {
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.rethrow = true;
                context.errorHandling.forceIncludeInReportIssueCommand = true;

                let treeItem: AzExtParentTreeItem;
                if (arg) {
                    treeItem = arg;
                } else {
                    context.telemetry.properties.isActivationEvent = 'true';
                    treeItem = this._rootTreeItem;
                }

                context.telemetry.properties.contextValue = treeItem.contextValue;

                const children: AzExtTreeItem[] = [...treeItem.creatingTreeItems, ...await treeItem.getCachedChildren(context)];
                const hasMoreChildren: boolean = treeItem.hasMoreChildrenImpl();
                context.telemetry.properties.hasMoreChildren = String(hasMoreChildren);

                const result: (AzExtTreeItem & { uniqueFullId?: string })[] = [];
                const duplicateChildren: AzExtTreeItem[] = [];
                for (const child of children) {
                    let shouldPushChild: boolean = true;
                    for (const resultChild of result) {
                        if (child.fullId === resultChild.fullId) {
                            if (child.contextValue === resultChild.contextValue) {
                                duplicateChildren.push(child);
                            } else {
                                result.push(Object.assign(child, { uniqueFullId: `${child.fullId}-${child.contextValue}` }));
                            }
                            shouldPushChild = false;
                            break;
                        }
                    }

                    shouldPushChild && result.push(child);
                }

                result.push(...duplicateChildren.map(c => {
                    const message: string = localize('elementWithId', 'An element with the following id already exists: {0}', c.fullId);
                    return new InvalidTreeItem(treeItem, new Error(message), { contextValue: 'azureextensionui.duplicate', label: c.label });
                }));

                if (hasMoreChildren && !treeItem.isLoadingMore) {
                    const loadMoreTI: GenericTreeItem = new GenericTreeItem(treeItem, {
                        label: loadMoreLabel,
                        iconPath: getThemedIconPath('refresh'),
                        contextValue: 'azureextensionui.loadMore',
                        commandId: this._loadMoreCommandId
                    });
                    loadMoreTI.commandArgs = [treeItem];
                    result.push(loadMoreTI);
                }

                context.telemetry.measurements.childCount = result.length;
                return result;
            });
        } catch (error) {
            return [new GenericTreeItem(arg, {
                label: localize('errorTreeItem', 'Error: {0}', parseError(error).message),
                contextValue: 'azureextensionui.error'
            })];
        }
    }

    public async refresh(context: types.IActionContext, treeItem?: AzExtTreeItem): Promise<void> {
        // tslint:disable-next-line: strict-boolean-expressions
        treeItem = treeItem || this._rootTreeItem;

        if (treeItem.refreshImpl) {
            await treeItem.refreshImpl(context);
        }

        if (isAzExtParentTreeItem(treeItem)) {
            (<AzExtParentTreeItem>treeItem).clearCache();
        }

        this.refreshUIOnly(treeItem);
    }

    public refreshUIOnly(_treeItem: AzExtTreeItem | undefined): void {
        // Pass undefined as temporary workaround for https://github.com/microsoft/vscode/issues/71698
        this._onDidChangeTreeDataEmitter.fire(undefined);
        // this._onDidChangeTreeDataEmitter.fire(treeItem === this._rootTreeItem ? undefined : treeItem);
    }

    public async loadMore(treeItem: AzExtParentTreeItem, context: types.IActionContext): Promise<void> {
        treeItem.isLoadingMore = true;
        try {
            this.refreshUIOnly(treeItem);
            await treeItem.loadMoreChildren(context);
        } finally {
            treeItem.isLoadingMore = false;
            this.refreshUIOnly(treeItem);
        }
    }

    public async showTreeItemPicker<T extends types.AzExtTreeItem>(expectedContextValues: string | (string | RegExp)[] | RegExp, context: types.ITreeItemPickerContext & { canPickMany: true }, startingTreeItem?: AzExtTreeItem): Promise<T[]>;
    public async showTreeItemPicker<T extends types.AzExtTreeItem>(expectedContextValues: string | (string | RegExp)[] | RegExp, context: types.ITreeItemPickerContext, startingTreeItem?: AzExtTreeItem): Promise<T>;
    public async showTreeItemPicker<T extends types.AzExtTreeItem>(expectedContextValues: string | (string | RegExp)[] | RegExp, context: types.ITreeItemPickerContext, startingTreeItem?: AzExtTreeItem): Promise<T | T[]> {
        if (!Array.isArray(expectedContextValues)) {
            expectedContextValues = [expectedContextValues];
        }

        // tslint:disable-next-line:strict-boolean-expressions
        let treeItem: AzExtTreeItem = startingTreeItem || this._rootTreeItem;

        while (!treeItem.matchesContextValue(expectedContextValues)) {
            if (isAzExtParentTreeItem(treeItem)) {
                const pickedItems: AzExtTreeItem | AzExtTreeItem[] = await (<AzExtParentTreeItem>treeItem).pickChildTreeItem(expectedContextValues, context);
                if (Array.isArray(pickedItems)) {
                    // canPickMany is only supported at the last stage of the picker, so automatically return if this is an array
                    return <T[]><unknown>pickedItems;
                } else {
                    treeItem = pickedItems;
                }
            } else {
                throw new NoResourceFoundError(context);
            }
        }

        addValuesToMaskFromAzureId(context, treeItem);
        return <T><unknown>treeItem;
    }

    public async getParent(treeItem: AzExtTreeItem): Promise<AzExtTreeItem | undefined> {
        return treeItem.parent === this._rootTreeItem ? undefined : treeItem.parent;
    }

    public async findTreeItem<T extends types.AzExtTreeItem>(fullId: string, context: types.IFindTreeItemContext): Promise<T | undefined> {
        let result: types.AzExtTreeItem | undefined;

        const existingTask: Promise<types.AzExtTreeItem | undefined> | undefined = this._findTreeItemTasks.get(fullId);
        if (existingTask) {
            result = await existingTask;
        } else {
            const newTask: Promise<types.AzExtTreeItem | undefined> = context.loadAll ?
                runWithLoadingNotification(context, cancellationToken => this.findTreeItemInternal(fullId, context, cancellationToken)) :
                this.findTreeItemInternal(fullId, context);
            this._findTreeItemTasks.set(fullId, newTask);
            try {
                result = await newTask;
            } finally {
                this._findTreeItemTasks.delete(fullId);
            }
        }

        return <T><unknown>result;
    }

    /**
     * Wrapped by `findTreeItem` to ensure only one find is happening per `fullId` at a time
     */
    private async findTreeItemInternal(fullId: string, context: types.IFindTreeItemContext, cancellationToken?: CancellationToken): Promise<types.AzExtTreeItem | undefined> {
        let treeItem: AzExtParentTreeItem = this._rootTreeItem;

        // tslint:disable-next-line: no-constant-condition
        outerLoop: while (true) {
            if (cancellationToken?.isCancellationRequested) {
                context.telemetry.properties.cancelStep = 'findTreeItem';
                throw new UserCancelledError();
            }

            const children: AzExtTreeItem[] = await treeItem.getCachedChildren(context);
            for (const child of children) {
                if (child.fullId === fullId) {
                    return child;
                } else if (isAncestor(child, fullId)) {
                    treeItem = <AzExtParentTreeItem>child;
                    continue outerLoop;
                }
            }

            if (context.loadAll && treeItem.hasMoreChildrenImpl()) {
                await treeItem.loadMoreChildren(context);
            } else {
                return undefined;
            }
        }
    }
}

function isAncestor(treeItem: AzExtTreeItem, fullId: string): boolean {
    // Append '/' to 'treeItem.fullId' when checking 'startsWith' to ensure its actually an ancestor, rather than a treeItem at the same level that _happens_ to start with the same id
    // For example, two databases named 'test' and 'test1' as described in this issue: https://github.com/Microsoft/vscode-cosmosdb/issues/488
    return fullId.startsWith(`${treeItem.fullId}/`) && isAzExtParentTreeItem(treeItem);
}
