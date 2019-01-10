/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSiteManagementModels } from 'azure-arm-website';
import { window } from 'vscode';
import { AzureTreeItem, IActionContext, IAzureQuickPickItem, IAzureQuickPickOptions, UserCancelledError } from 'vscode-azureextensionui';
import { connectToGitHub } from './connectToGitHub';
import { ext } from './extensionVariables';
import { localize } from './localize';
import { ScmType } from './ScmType';
import { SiteClient } from './SiteClient';
import { ISiteTreeRoot } from './tree/ISiteTreeRoot';
import { nonNullProp } from './utils/nonNull';

export async function editScmType(client: SiteClient, node: AzureTreeItem<ISiteTreeRoot>, context: IActionContext, newScmType?: ScmType): Promise<ScmType | undefined> {
    const config: WebSiteManagementModels.SiteConfigResource = await client.getSiteConfig();
    // tslint:disable-next-line:strict-boolean-expressions
    newScmType = newScmType ? newScmType : await showScmPrompt(nonNullProp(config, 'scmType'));
    if (newScmType === ScmType.GitHub) {
        if (config.scmType !== ScmType.None) {
            // GitHub cannot be configured if there is an existing configuration source-- a limitation of Azure
            throw new Error(localize('configurationError', 'Configuration type must be set to "None" to connect to a GitHub repository.'));
        }
        await connectToGitHub(node, client, context);
    } else {
        config.scmType = newScmType;
        // to update one property, a complete config file must be sent
        await client.updateConfiguration(config);
    }
    const scmTypeUpdated: string = localize('deploymentSourceUpdated,', 'Deployment source for "{0}" has been updated to "{1}".', client.fullName, newScmType);
    ext.outputChannel.appendLine(scmTypeUpdated);
    window.showInformationMessage(scmTypeUpdated);

    if (newScmType === ScmType.LocalGit) {
        const user: WebSiteManagementModels.User = await client.getPublishingUser();
        if (user.publishingUserName) {
            // first time users must set up deployment credentials via the Portal or they will not have a UserName
            const gitCloneUri: string = `https://${user.publishingUserName}@${client.gitUrl}`;
            ext.outputChannel.appendLine(localize('gitCloneUri', 'Git Clone Uri for "{0}": "{1}"', client.fullName, gitCloneUri));
        }
    }
    // returns the updated scmType
    return newScmType;
}

async function showScmPrompt(currentScmType: string): Promise<ScmType> {
    const currentSource: string = localize('currentSource', '(Current source)');
    const scmQuickPicks: IAzureQuickPickItem<ScmType | undefined>[] = [];
    // generate quickPicks to not include current type
    for (const key of Object.keys(ScmType)) {
        const scmType: ScmType = <ScmType>ScmType[key];
        if (scmType === currentScmType) {
            // put the current source at the top of the list
            scmQuickPicks.unshift({ label: scmType, description: currentSource, data: undefined });
        } else {
            scmQuickPicks.push({ label: scmType, description: '', data: scmType });
        }
    }

    const options: IAzureQuickPickOptions = {
        placeHolder: localize('scmPrompt', 'Select a new source.'),
        suppressPersistence: true
    };
    const newScmType: ScmType | undefined = (await ext.ui.showQuickPick(scmQuickPicks, options)).data;
    if (newScmType === undefined) {
        // if the user clicks the current source, treat it as a cancel
        throw new UserCancelledError();
    } else {
        return newScmType;
    }
}
