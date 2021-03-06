/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as types from '../../index';
import { openInPortal } from '../openInPortal';
import { nonNullProp } from '../utils/nonNull';
import { AzExtParentTreeItem } from './AzExtParentTreeItem';
import { IAzExtParentTreeItemInternal } from './InternalInterfaces';

export abstract class AzureParentTreeItem<TRoot extends types.ISubscriptionContext = types.ISubscriptionContext> extends AzExtParentTreeItem implements types.AzureParentTreeItem<TRoot> {
    public readonly parent: types.AzureParentTreeItem<TRoot> & IAzExtParentTreeItemInternal | undefined;

    public get root(): TRoot {
        return nonNullProp(this, 'parent').root;
    }

    public async openInPortal(options?: types.OpenInPortalOptions): Promise<void> {
        await openInPortal(this.root, this.fullId, options);
    }
}
