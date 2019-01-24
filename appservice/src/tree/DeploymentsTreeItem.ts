/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SiteConfig, SiteSourceControl } from 'azure-arm-website/lib/models';
import * as path from 'path';
import { MessageItem } from 'vscode';
import { AzureParentTreeItem, createTreeItemsWithErrorHandling, DialogResponses, GenericTreeItem, IActionContext } from 'vscode-azureextensionui';
import KuduClient from 'vscode-azurekudu';
import { DeployResult } from 'vscode-azurekudu/lib/models';
import { editScmType } from '../editScmType';
import { ext } from '../extensionVariables';
import { getKuduClient } from '../getKuduClient';
import { localize } from '../localize';
import { ScmType } from '../ScmType';
import { DeploymentTreeItem } from './DeploymentTreeItem';
import { ISiteTreeRoot } from './ISiteTreeRoot';

export class DeploymentsTreeItem extends AzureParentTreeItem<ISiteTreeRoot> {
    public static contextValueConnected: string = 'deploymentsConnected';
    public static contextValueUnconnected: string = 'deploymentsUnconnected';
    public contextValue: string;
    public parent: AzureParentTreeItem<ISiteTreeRoot>;
    public readonly label: string = localize('Deployments', 'Deployments');
    public readonly childTypeLabel: string = localize('Deployment', 'Deployment');

    private readonly _connectToGitHubCommandId: string;

    public constructor(parent: AzureParentTreeItem<ISiteTreeRoot>, siteConfig: SiteConfig, connectToGitHubCommandId: string) {
        super(parent);
        this.contextValue = siteConfig.scmType === ScmType.None ? DeploymentsTreeItem.contextValueUnconnected : DeploymentsTreeItem.contextValueConnected;
        this._connectToGitHubCommandId = connectToGitHubCommandId;
    }

    public get iconPath(): { light: string, dark: string } {
        return {
            light: path.join(__filename, '..', '..', '..', 'resources', 'light', 'Deployments_x16.svg'),
            dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', 'Deployments_x16.svg')
        };
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<DeploymentTreeItem[] | GenericTreeItem<ISiteTreeRoot>[]> {
        const siteConfig: SiteConfig = await this.root.client.getSiteConfig();
        const kuduClient: KuduClient = await getKuduClient(this.root.client);
        const deployments: DeployResult[] = await kuduClient.deployment.getDeployResults();
        const children: DeploymentTreeItem[] | GenericTreeItem<ISiteTreeRoot>[] = await createTreeItemsWithErrorHandling(
            this,
            deployments,
            'invalidDeployment',
            (dr: DeployResult) => {
                return new DeploymentTreeItem(this, dr);
            },
            (dr: DeployResult) => {
                return dr.id ? dr.id.substring(0, 7) : undefined;
            }
        );

        if (siteConfig.scmType === ScmType.None) {
            // redeploy does not support Push deploys, so we still guide users to connect to a GitHub repo
            children.push(new GenericTreeItem(this, {
                commandId: this._connectToGitHubCommandId,
                contextValue: 'ConnectToGithub',
                label: 'Connect to a GitHub Repository...'
            }));
        }
        return children;
    }

    public compareChildrenImpl(ti1: DeploymentTreeItem, ti2: DeploymentTreeItem): number {
        if (ti1 instanceof GenericTreeItem) {
            return 1;
        } else if (ti2 instanceof GenericTreeItem) {
            return -1;
        }
        // sorts in accordance of the most recent deployment
        return ti2.receivedTime.valueOf() - ti1.receivedTime.valueOf();
    }

    public async disconnectRepo(context: IActionContext): Promise<void> {
        const sourceControl: SiteSourceControl = await this.root.client.getSourceControl();
        const disconnectButton: MessageItem = { title: localize('disconnect', 'Disconnect') };
        const disconnect: string = localize('disconnectFromRepo', 'Disconnect from "{0}"? This will not affect your app\'s active deployment. You may reconnect a repository at any time.', sourceControl.repoUrl);
        await ext.ui.showWarningMessage(disconnect, { modal: true }, disconnectButton, DialogResponses.cancel);
        await editScmType(this.root.client, this.parent, context, ScmType.None);
        await this.refresh();
    }

    public async refreshImpl(): Promise<void> {
        const siteConfig: SiteConfig = await this.root.client.getSiteConfig();
        if (siteConfig.scmType === ScmType.GitHub || siteConfig.scmType === ScmType.LocalGit) {
            this.contextValue = DeploymentsTreeItem.contextValueConnected;
        } else {
            this.contextValue = DeploymentsTreeItem.contextValueUnconnected;
        }
    }
}
