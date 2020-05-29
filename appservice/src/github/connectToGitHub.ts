/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SiteSourceControl } from 'azure-arm-website/lib/models';
import { TokenCredentials } from 'ms-rest';
import { Response } from 'request';
import { isArray } from 'util';
import * as vscode from 'vscode';
import { AzureTreeItem, AzureWizard, DialogResponses, IActionContext, IAzureQuickPickItem, IParsedError, openInPortal, parseError } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { localize } from '../localize';
import { SiteClient } from '../SiteClient';
import { DeploymentsTreeItem } from '../tree/DeploymentsTreeItem';
import { nonNullProp } from '../utils/nonNull';
import { openUrl } from '../utils/openUrl';
import { requestUtils } from '../utils/requestUtils';
import { verifyNoRunFromPackageSetting } from '../verifyNoRunFromPackageSetting';
import { GitHubBranchListStep } from './GitHubBranchListStep';
import { GitHubOrgListStep } from './GitHubOrgListStep';
import { GitHubRepoListStep } from './GitHubRepoListStep';
import { IConnectToGitHubWizardContext } from './IConnectToGitHubWizardContext';

export type gitHubOrgData = { login: string, repos_url: string };
export type gitHubRepoData = { name: string, repos_url: string, url: string, html_url: string };
export type gitHubBranchData = { name: string };
export type gitHubLink = { prev?: string, next?: string, last?: string, first?: string };
export type gitHubWebResource = requestUtils.Request & { nextLink?: string };

export async function connectToGitHub(node: DeploymentsTreeItem | AzureTreeItem, client: SiteClient, context: IConnectToGitHubWizardContext): Promise<void> {
    const title: string = localize('connectGitHubRepo', 'Connect GitHub repository');
    context.client = client;
    context.node = node;

    const wizard: AzureWizard<IConnectToGitHubWizardContext> = new AzureWizard(context, {
        title,
        promptSteps: [
            new GitHubOrgListStep(),
            new GitHubRepoListStep(),
            new GitHubBranchListStep()
        ]
    });

    await wizard.prompt();

    const siteSourceControl: SiteSourceControl = {
        repoUrl: nonNullProp(context, 'repoData').html_url,
        branch: nonNullProp(context, 'branchData').name,
        isManualIntegration: false,
        deploymentRollbackEnabled: true,
        isMercurial: false
    };

    const repoName: string = `${nonNullProp(context, 'orgData').login}/${nonNullProp(context, 'repoData').name}`;

    try {
        const connectingToGithub: string = localize('ConnectingToGithub', '"{0}" is being connected to repo "{1}". This may take several minutes...', client.fullName, repoName);
        const connectedToGithub: string = localize('ConnectedToGithub', 'Repo "{0}" is connected and deployed to "{1}".', repoName, client.fullName);
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: connectingToGithub }, async (): Promise<void> => {
            ext.outputChannel.appendLog(connectingToGithub);
            await verifyNoRunFromPackageSetting(client);
            await client.updateSourceControl(siteSourceControl);
            vscode.window.showInformationMessage(connectedToGithub);
            ext.outputChannel.appendLog(connectedToGithub);
        });
    } catch (err) {
        try {
            // a resync will fix the first broken build
            // https://github.com/projectkudu/kudu/issues/2277
            await client.syncRepository();
        } catch (error) {
            const parsedError: IParsedError = parseError(error);
            // The portal returns 200, but is expecting a 204 which causes it to throw an error even after a successful sync
            if (parsedError.message.indexOf('"statusCode":200') === -1) {
                throw error;
            }
        }
    }
}

async function showGitHubAuthPrompt(node: DeploymentsTreeItem | AzureTreeItem, client: SiteClient, context: IActionContext): Promise<void> {
    const invalidToken: string = localize('tokenExpired', 'Azure\'s GitHub token is invalid.  Authorize in the "Deployment Center"');
    const goToPortal: vscode.MessageItem = { title: localize('goToPortal', 'Go to Portal') };
    let input: vscode.MessageItem | undefined = DialogResponses.learnMore;
    while (input === DialogResponses.learnMore) {
        input = await vscode.window.showErrorMessage(invalidToken, { modal: true }, goToPortal, DialogResponses.learnMore);
        if (input === DialogResponses.learnMore) {

            context.telemetry.properties.githubLearnMore = 'true';

            await openUrl('https://aka.ms/B7g6sw');
        }
    }

    if (input === goToPortal) {
        context.telemetry.properties.githubGoToPortal = 'true';
        if (node.root) {
            await openInPortal(node.root, `${client.id}/vstscd`);
        } else {
            throw Error('Cannot open in portal.');
        }
    }
}

export async function getGitHubJsonResponse<T>(context: IConnectToGitHubWizardContext, requestOptions: gitHubWebResource): Promise<T> {
    // Reference for GitHub REST routes
    // https://developer.github.com/v3/
    // Note: blank after user implies look up authorized user
    try {
        const gitHubResponse: Response = await requestUtils.sendRequest(requestOptions);
        if (gitHubResponse.headers.link) {
            const headerLink: string = <string>gitHubResponse.headers.link;
            const linkObject: gitHubLink = parseLinkHeaderToGitHubLinkObject(headerLink);
            requestOptions.nextLink = linkObject.next;
        }
        // tslint:disable-next-line:no-unsafe-any
        return <T>JSON.parse(gitHubResponse.body);
    } catch (error) {
        const parsedError: IParsedError = parseError(error);
        if (parsedError.message.indexOf('Bad credentials') > -1) {
            // the default error is just "Bad credentials," which is an unhelpful error message
            await showGitHubAuthPrompt(nonNullProp(context, 'node'), nonNullProp(context, 'client'), context);
            context.errorHandling.suppressDisplay = true;
        }
        throw error;
    }
}

/**
 * @param label Property of JSON that will be used as the QuickPicks label
 * @param description Optional property of JSON that will be used as QuickPicks description
 * @param data Optional property of JSON that will be used as QuickPicks data saved as a NameValue pair
 */
export function createQuickPickFromJsons<T>(jsons: T[], label: string): IAzureQuickPickItem<T>[] {
    const quickPicks: IAzureQuickPickItem<T>[] = [];
    if (!isArray(jsons)) {
        jsons = [jsons];
    }

    for (const json of jsons) {
        if (!json[label]) {
            // skip this JSON if it doesn't have this label
            continue;
        }

        quickPicks.push({
            label: <string>json[label],
            data: json
        });
    }

    return quickPicks;
}

function parseLinkHeaderToGitHubLinkObject(linkHeader: string): gitHubLink {
    const linkUrls: string[] = linkHeader.split(', ');
    const linkMap: gitHubLink = {};

    // link header response is "<https://api.github.com/organizations/6154722/repos?page=2>; rel="prev", <https://api.github.com/organizations/6154722/repos?page=4>; rel="next""
    const relative: string = 'rel=';
    for (const url of linkUrls) {
        linkMap[url.substring(url.indexOf(relative) + relative.length + 1, url.length - 1)] = url.substring(url.indexOf('<') + 1, url.indexOf('>'));
    }
    return linkMap;
}

export interface ICachedQuickPicks<T> {
    picks: IAzureQuickPickItem<T>[];
}

export async function getGitHubQuickPicksWithLoadMore<T>(context: IConnectToGitHubWizardContext, cache: ICachedQuickPicks<T>, requestOptions: gitHubWebResource, labelName: string, timeoutSeconds: number = 10): Promise<IAzureQuickPickItem<T | undefined>[]> {
    const timeoutMs: number = timeoutSeconds * 1000;
    const startTime: number = Date.now();
    let gitHubQuickPicks: T[] = [];
    do {
        gitHubQuickPicks = gitHubQuickPicks.concat(await getGitHubJsonResponse<T[]>(context, requestOptions));
        if (requestOptions.nextLink) {
            // if there is another link, set the next request url to point at that
            requestOptions.url = requestOptions.nextLink;
        }
    } while (requestOptions.nextLink && startTime + timeoutMs > Date.now());

    cache.picks = cache.picks.concat(createQuickPickFromJsons(gitHubQuickPicks, labelName));
    cache.picks.sort((a: vscode.QuickPickItem, b: vscode.QuickPickItem) => a.label.localeCompare(b.label));

    if (requestOptions.nextLink) {
        return (<IAzureQuickPickItem<T | undefined>[]>[{
            label: '$(sync) Load More',
            suppressPersistence: true,
            data: undefined
        }]).concat(cache.picks);
    } else {
        return cache.picks;
    }
}

export async function createRequestOptions(context: IConnectToGitHubWizardContext, url: string): Promise<gitHubWebResource> {
    const client: SiteClient = nonNullProp(context, 'client');
    const oAuth2Token: string | undefined = (await client.listSourceControls())[0].token;
    if (!oAuth2Token) {
        await showGitHubAuthPrompt(nonNullProp(context, 'node'), client, context);
        context.errorHandling.suppressDisplay = true;
        const noToken: string = localize('noToken', 'No oAuth2 Token.');
        throw new Error(noToken);
    }

    const requestOptions: gitHubWebResource = await requestUtils.getDefaultRequest(url, new TokenCredentials(oAuth2Token));
    requestOptions.resolveWithFullResponse = true;
    return requestOptions;
}
