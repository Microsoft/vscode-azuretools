/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tslint:disable-next-line:no-require-imports
import WebSiteManagementClient = require('azure-arm-website');
import { Site, SiteConfigResource, User } from 'azure-arm-website/lib/models';
import * as fs from 'fs';
import { BasicAuthenticationCredentials } from 'ms-rest';
import * as git from 'simple-git/promise';
import * as vscode from 'vscode';
import KuduClient from 'vscode-azurekudu';
import { DeployResult } from 'vscode-azurekudu/lib/models';
import * as errors from './errors';
import * as FileUtilities from './FileUtilities';
import { localize } from './localize';

export class SiteWrapper {
    public readonly resourceGroup: string;
    public readonly name: string;
    public readonly slotName?: string;
    private readonly _gitUrl: string;

    constructor(site: Site) {
        if (!site.name || !site.resourceGroup || !site.type) {
            throw new errors.ArgumentError(site);
        }

        const isSlot: boolean = site.type.toLowerCase() === 'microsoft.web/sites/slots';
        this.resourceGroup = site.resourceGroup;
        this.name = isSlot ? site.name.substring(0, site.name.lastIndexOf('/')) : site.name;
        this.slotName = isSlot ? site.name.substring(site.name.lastIndexOf('/') + 1) : undefined;
        // the scm url used for git repo is in index 1 of enabledHostNames, not 0
        this._gitUrl = `${site.enabledHostNames[1]}:443/${site.repositorySiteName}.git`;
    }

    public get appName(): string {
        return this.name + (this.slotName ? `-${this.slotName}` : '');
    }

    public async stop(client: WebSiteManagementClient): Promise<void> {
        if (this.slotName) {
            await client.webApps.stopSlot(this.resourceGroup, this.name, this.slotName);
        } else {
            await client.webApps.stop(this.resourceGroup, this.name);
        }
    }

    public async start(client: WebSiteManagementClient): Promise<void> {
        if (this.slotName) {
            await client.webApps.startSlot(this.resourceGroup, this.name, this.slotName);
        } else {
            await client.webApps.start(this.resourceGroup, this.name);
        }
    }

    public async getState(client: WebSiteManagementClient): Promise<string | undefined> {
        const currentSite: Site = this.slotName ?
            await client.webApps.getSlot(this.resourceGroup, this.name, this.slotName) :
            await client.webApps.get(this.resourceGroup, this.name);

        return currentSite.state;
    }

    public async getWebAppPublishCredential(client: WebSiteManagementClient): Promise<User> {
        return this.slotName ?
            await client.webApps.listPublishingCredentialsSlot(this.resourceGroup, this.name, this.slotName) :
            await client.webApps.listPublishingCredentials(this.resourceGroup, this.name);
    }

    public async getSiteConfig(client: WebSiteManagementClient): Promise<SiteConfigResource> {
        return this.slotName ?
            await client.webApps.getConfigurationSlot(this.resourceGroup, this.name, this.slotName) :
            await client.webApps.getConfiguration(this.resourceGroup, this.name);
    }

    public async updateConfiguration(client: WebSiteManagementClient, config: SiteConfigResource): Promise<SiteConfigResource> {
        return this.slotName ?
            await client.webApps.updateConfigurationSlot(this.resourceGroup, this.appName, config, this.slotName) :
            await client.webApps.updateConfiguration(this.resourceGroup, this.appName, config);
    }

    public async deployZip(fsPath: string, client: WebSiteManagementClient, outputChannel: vscode.OutputChannel): Promise<void> {
        const yes: string = 'Yes';
        const warning: string = localize('zipWarning', 'Are you sure you want to deploy to "{0}"? This will overwrite any previous deployment and cannot be undone.', this.appName);
        if (await vscode.window.showWarningMessage(warning, yes) !== yes) {
            return;
        }

        outputChannel.show();
        const kuduClient: KuduClient = await this.getKuduClient(client);

        let zipFilePath: string;
        let createdZip: boolean = false;
        if (FileUtilities.getFileExtension(fsPath) === 'zip') {
            zipFilePath = fsPath;
        } else if (await FileUtilities.isDirectory(fsPath)) {
            createdZip = true;
            this.log(outputChannel, 'Creating zip package...');
            zipFilePath = await FileUtilities.zipDirectory(fsPath);
        } else {
            throw new Error(localize('NotAZipError', 'Path specified is not a folder or a zip file'));
        }

        try {
            this.log(outputChannel, 'Starting deployment...');
            await kuduClient.pushDeployment.zipPushDeploy(fs.createReadStream(zipFilePath), { isAsync: true });
            await this.waitForDeploymentToComplete(kuduClient, outputChannel);
        } catch (error) {
            // tslint:disable-next-line:no-unsafe-any
            if (error && error.response && error.response.body) {
                // Autorest doesn't support plain/text as a MIME type, so we have to get the error message from the response body ourselves
                // https://github.com/Azure/autorest/issues/1527
                // tslint:disable-next-line:no-unsafe-any
                throw new Error(error.response.body);
            } else {
                throw error;
            }
        } finally {
            if (createdZip) {
                await FileUtilities.deleteFile(zipFilePath);
            }
        }

        this.log(outputChannel, 'Deployment completed.');
    }

    public async localGitDeploy(fsPath: string, client: WebSiteManagementClient, outputChannel: vscode.OutputChannel, servicePlan: string): Promise<DeployResult | undefined> {
        const kuduClient: KuduClient = await this.getKuduClient(client);
        const yes: string = 'Yes';
        const pushReject: string = localize('localGitPush', 'Push rejected due to Git history diverging. Force push?');
        const scmType: string = 'LocalGit';

        const [publishCredentials, config]: [User, SiteConfigResource] = await Promise.all([
            this.getWebAppPublishCredential(client),
            this.getSiteConfig(client)
        ]);

        if (config.scmType !== scmType) {
            // SCM must be set to LocalGit prior to deployment
            const scmUpdate: string | undefined = await this.updateScmType(client, config, scmType);
            if (scmUpdate !== scmType) {
                // if the new config scmType doesn't equal LocalGit, user either canceled or there was an error
                return undefined;
            }
        }
        // credentials for accessing Azure Remote Repo
        const username: string = publishCredentials.publishingUserName;
        const password: string = publishCredentials.publishingPassword;
        const remote: string = `https://${username}:${password}@${this._gitUrl}`;
        const localGit: git.SimpleGit = git(fsPath);
        try {

            const status: git.StatusResult = await localGit.status();
            if (status.files.length > 0) {
                const uncommit: string = localize('localGitUncommit', '{0} uncommitted change(s) in local repo "{1}"', status.files.length, fsPath);
                vscode.window.showWarningMessage(uncommit);
            }
            await localGit.push(remote, 'HEAD:master');
        } catch (err) {
            // tslint:disable-next-line:no-unsafe-any
            if (err.message.indexOf('spawn git ENOENT') >= 0) {
                throw new errors.GitNotInstalledError();
            } else if (err.message.indexOf('error: failed to push') >= 0) { // tslint:disable-line:no-unsafe-any
                const input: string | undefined = await vscode.window.showErrorMessage(pushReject, yes);
                if (input === 'Yes') {
                    await (<(remote: string, branch: string, options: object) => Promise<void>>localGit.push)(remote, 'HEAD:master', { '-f': true });
                    // Ugly casting neccessary due to bug in simple-git. Issue filed:
                    // https://github.com/steveukx/git-js/issues/218
                } else {
                    return undefined;
                }
            } else {
                // tslint:disable-next-line:no-unsafe-any
                throw new errors.LocalGitDeployError(err, servicePlan);
            }
        }
        return await this.waitForDeploymentToComplete(kuduClient, outputChannel);
    }

    private async waitForDeploymentToComplete(kuduClient: KuduClient, outputChannel: vscode.OutputChannel, pollingInterval: number = 5000): Promise<DeployResult> {
        // Unfortunately, Kudu doesn't provide a unique id for a deployment right after it's started
        // However, Kudu only supports one deployment at a time, so 'latest' will work in most cases
        let deploymentId: string = 'latest';
        let deployment: DeployResult = await kuduClient.deployment.getResult(deploymentId);
        while (!deployment.complete) {
            if (!deployment.isTemp && deployment.id) {
                // Switch from 'latest' to the permanent/unique id as soon as it's available
                deploymentId = deployment.id;
            }

            if (deployment.progress) {
                this.log(outputChannel, deployment.progress);
            }

            await new Promise((resolve: () => void): void => { setTimeout(resolve, pollingInterval); });
            deployment = await kuduClient.deployment.getResult(deploymentId);
        }

        return deployment;
    }

    private log(outputChannel: vscode.OutputChannel, message: string): void {
        outputChannel.appendLine(`${(new Date()).toLocaleTimeString()} ${this.appName}: ${message}`);
    }

    private async getKuduClient(client: WebSiteManagementClient): Promise<KuduClient> {
        const user: User = await this.getWebAppPublishCredential(client);
        if (!user.publishingUserName || !user.publishingPassword) {
            throw new errors.ArgumentError(user);
        }

        const cred: BasicAuthenticationCredentials = new BasicAuthenticationCredentials(user.publishingUserName, user.publishingPassword);

        return new KuduClient(cred, `https://${this.appName}.scm.azurewebsites.net`);
    }

    private async updateScmType(client: WebSiteManagementClient, config: SiteConfigResource, scmType: string): Promise<string | undefined> {
        const oldScmType: string = config.scmType;
        const updateScm: string = localize('updateScm', 'Deployment source for "{0}" is set as "{1}".  Change to "{2}"?', this.appName, oldScmType, scmType);
        const yes: string = 'Yes';
        let input: string | undefined;

        config.scmType = scmType;
        // to update one property, a complete config file must be sent
        input = await vscode.window.showWarningMessage(updateScm, yes);
        if (input === 'Yes') {
            const newConfig: SiteConfigResource = await this.updateConfiguration(client, config);
            return newConfig.scmType;
        }
        return undefined;
    }
}
