/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tslint:disable-next-line:no-require-imports
import StorageManagementClient = require('azure-arm-storage');
import { StorageAccount } from 'azure-arm-storage/lib/models';
import * as opn from 'opn';
import { isString } from 'util';
import { IAzureNamingRules, IAzureQuickPickItem, IAzureQuickPickOptions, IAzureUserInput, IStorageAccountCreateOptions, IStorageAccountFilterOptions, IStorageAccountWizardContext } from '../../index';
import { UserCancelledError } from '../errors';
import { localize } from '../localize';
import { AzureWizard } from './AzureWizard';
import { AzureWizardPromptStep } from './AzureWizardPromptStep';
import { LocationListStep } from './LocationListStep';
import { ResourceGroupListStep } from './ResourceGroupListStep';
import { StorageAccountCreateStep } from './StorageAccountCreateStep';
import { StorageAccountNameStep } from './StorageAccountNameStep';

export const storageAccountNamingRules: IAzureNamingRules = {
    minLength: 3,
    maxLength: 24,
    invalidCharsRegExp: /[^a-z0-9]/,
    lowercaseOnly: true
};

export enum StorageAccountKind {
    Storage = 'Storage',
    StorageV2 = 'StorageV2',
    BlobStorage = 'BlobStorage'
}

export enum StorageAccountPerformance {
    Standard = 'Standard',
    Premium = 'Premium'
}

export enum StorageAccountReplication {
    /**
     * Locally redundant storage
     */
    LRS = 'LRS',

    /**
     * Zone-redundant storage
     */
    ZRS = 'ZRS',

    /**
     * Geo-redundant storage
     */
    GRS = 'GRS',

    /**
     * Read-access geo-redundant storage
     */
    RAGRS = 'RAGRS'
}

export class StorageAccountListStep<T extends IStorageAccountWizardContext> extends AzureWizardPromptStep<T> {
    private readonly _createOptions: IStorageAccountCreateOptions;
    private readonly _filterOptions: IStorageAccountFilterOptions;

    public constructor(createOptions: IStorageAccountCreateOptions, filterOptions?: IStorageAccountFilterOptions) {
        super();
        this._createOptions = createOptions;
        // tslint:disable-next-line:strict-boolean-expressions
        this._filterOptions = filterOptions || {};
    }

    public static async isNameAvailable<T extends IStorageAccountWizardContext>(wizardContext: T, name: string): Promise<boolean> {
        const storageClient: StorageManagementClient = new StorageManagementClient(wizardContext.credentials, wizardContext.subscriptionId);
        return !!(await storageClient.storageAccounts.checkNameAvailability(name)).nameAvailable;
    }

    public async prompt(wizardContext: T, ui: IAzureUserInput): Promise<T> {
        if (!wizardContext.storageAccount && !wizardContext.newStorageAccountName) {
            const client: StorageManagementClient = new StorageManagementClient(wizardContext.credentials, wizardContext.subscriptionId);

            const quickPickOptions: IAzureQuickPickOptions = { placeHolder: 'Select a storage account.', id: `StorageAccountListStep/${wizardContext.subscriptionId}` };
            const result: StorageAccount | undefined | string = (await ui.showQuickPick(this.getQuickPicks(client.storageAccounts.list()), quickPickOptions)).data;
            if (isString(result)) {
                // tslint:disable:no-unsafe-any
                opn(result);
                throw new UserCancelledError();
            }

            wizardContext.storageAccount = result;
            if (wizardContext.storageAccount) {
                // tslint:disable-next-line:no-non-null-assertion
                await LocationListStep.setLocation(wizardContext, wizardContext.storageAccount.location!);
            } else {
                this.subWizard = new AzureWizard(
                    [new StorageAccountNameStep(), new ResourceGroupListStep(), new LocationListStep()],
                    [new StorageAccountCreateStep(this._createOptions)],
                    wizardContext
                );
            }
        }

        return wizardContext;
    }

    private async getQuickPicks(storageAccountsTask: Promise<StorageAccount[]>): Promise<IAzureQuickPickItem<StorageAccount | undefined | string>[]> {
        const picks: IAzureQuickPickItem<StorageAccount | undefined | string>[] = [{
            label: localize('NewStorageAccount', '$(plus) Create new storage account'),
            description: '',
            data: undefined
        }];

        const kindRegExp: RegExp = new RegExp(convertFilterToPattern(this._filterOptions.kind), 'i');
        const skuRegExp: RegExp = new RegExp(`${convertFilterToPattern(this._filterOptions.performance)}_${convertFilterToPattern(this._filterOptions.replication)}`, 'i');

        let hasFilteredAccounts: boolean = false;
        const storageAccounts: StorageAccount[] = await storageAccountsTask;
        for (const sa of storageAccounts) {
            // tslint:disable:strict-boolean-expressions
            if (!sa.kind || !sa.kind.match(kindRegExp) || !sa.sku || !sa.sku.name.match(skuRegExp)) {
                // tslint:enable:strict-boolean-expressions
                hasFilteredAccounts = true;
                continue;
            }

            picks.push({
                id: sa.id,
                // tslint:disable-next-line:no-non-null-assertion
                label: sa.name!,
                description: '',
                data: sa
            });
        }

        if (hasFilteredAccounts && this._filterOptions.learnMoreLink) {
            picks.push({
                label: localize('filtered', '$(info) Some storage accounts were filtered. Learn more...'),
                description: '',
                suppressPersistence: true,
                data: this._filterOptions.learnMoreLink
            });
        }

        return picks;
    }
}

function convertFilterToPattern(values?: string[]): string {
    return values ? `(${values.join('|')})` : '.*';
}
