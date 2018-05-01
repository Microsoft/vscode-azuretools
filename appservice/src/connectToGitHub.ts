/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NameValuePair, SiteSourceControl } from 'azure-arm-website/lib/models';
import { TokenCredentials, WebResource } from 'ms-rest';
import * as opn from 'opn';
import { Response } from 'request';
import * as request from 'request-promise';
import * as vscode from 'vscode';
import { IAzureNode, IAzureQuickPickItem, IParsedError, parseError, UserCancelledError } from 'vscode-azureextensionui';
import { localize } from './localize';
import { signRequest } from './signRequest';
import { SiteClient } from './SiteClient';

type gitHubOrgData = { repos_url?: string };
type gitHubReposData = { repos_url?: string, url?: string, html_url?: string };
// tslint:disable-next-line:no-reserved-keywords
type gitHubWebResource = WebResource & { resolveWithFullResponse?: boolean, nextLink?: string, lastLink?: string, type?: string };

export async function connectToGitHub(node: IAzureNode, client: SiteClient, outputChannel: vscode.OutputChannel): Promise<void> {
    const requestOptions: gitHubWebResource = new WebResource();
    let repoSelected: boolean = false;
    requestOptions.resolveWithFullResponse = true;
    requestOptions.headers = {
        ['User-Agent']: 'vscode-azureappservice-extension'
    };
    const oAuth2Token: string = (await client.listSourceControls())[0].token;
    if (!oAuth2Token) {
        await showGitHubAuthPrompt();
        return;
    }

    await signRequest(requestOptions, new TokenCredentials(oAuth2Token));
    requestOptions.url = 'https://api.github.com/user';
    const gitHubUser: Object[] = await getJsonRequest(requestOptions, node);
    requestOptions.url = 'https://api.github.com/user/orgs';
    const gitHubOrgs: Object[] = await getJsonRequest(requestOptions, node);
    const orgQuickPicks: IAzureQuickPickItem<{}>[] = createQuickPickFromJsons([gitHubUser], 'login', undefined, ['repos_url']).concat(createQuickPickFromJsons(gitHubOrgs, 'login', undefined, ['repos_url']));
    const orgQuickPick: gitHubOrgData = (await node.ui.showQuickPick(orgQuickPicks, { placeHolder: 'Choose your organization.' })).data;
    let repoQuickPick: gitHubReposData;
    requestOptions.url = orgQuickPick.repos_url;
    const gitHubRepos: Object[] = await getJsonRequest(requestOptions, node);
    const repoQuickPicks: IAzureQuickPickItem<{}>[] = createQuickPickFromJsons(gitHubRepos, 'name', undefined, ['url', 'html_url']);
    while (!repoSelected) {
        if (requestOptions.nextLink && requestOptions.url !== requestOptions.lastLink) {
            // this makes sure that a nextLink exists and that the last requested url wasn't the last page
            repoQuickPicks.push({
                label: '$(sync) Load More',
                description: '',
                data: {
                    url: requestOptions.nextLink
                },
                suppressPersistence: true
            });
        }
        repoQuickPick = (await node.ui.showQuickPick(repoQuickPicks, { placeHolder: 'Choose project.' })).data;

        if (repoQuickPick.url === requestOptions.nextLink) {
            requestOptions.url = requestOptions.nextLink;
            // remove the stale Load More quick pick
            repoQuickPicks.pop();
            const moreGitHubRepos: Object[] = await getJsonRequest(requestOptions, node);
            createQuickPickFromJsons(moreGitHubRepos, 'name', undefined, ['url', 'html_url'], repoQuickPicks);
        } else {
            repoSelected = true;
        }
    }

    requestOptions.url = `${repoQuickPick.url}/branches`;
    const gitHubBranches: Object[] = await getJsonRequest(requestOptions, node);
    const branchQuickPicks: IAzureQuickPickItem<{}>[] = createQuickPickFromJsons(gitHubBranches, 'name');
    const branchQuickPick: IAzureQuickPickItem<{}> = await node.ui.showQuickPick(branchQuickPicks, { placeHolder: 'Choose branch.' });

    const siteSourceControl: SiteSourceControl = {
        location: client.location,
        repoUrl: repoQuickPick.html_url,
        branch: branchQuickPick.label,
        isManualIntegration: false,
        deploymentRollbackEnabled: true,
        isMercurial: false
    };

    outputChannel.show(true);
    outputChannel.appendLine(`"${client.fullName}" is being connected to the GitHub repo. This may take several minutes...`);
    try {
        await client.updateSourceControl(siteSourceControl);
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

async function showGitHubAuthPrompt(): Promise<void> {
    const learnMore: string = localize('learnMore', 'Learn More');
    const setupGithub: string = localize('setupGithub', 'You must give Azure access to your GitHub account.');
    const input: string | undefined = await vscode.window.showErrorMessage(setupGithub, learnMore);
    if (input === learnMore) {
        // tslint:disable-next-line:no-unsafe-any
        opn('https://aka.ms/B7g6sw');
    }
}

async function getJsonRequest(requestOptions: gitHubWebResource, node: IAzureNode): Promise<Object[]> {
    // Reference for GitHub REST routes
    // https://developer.github.com/v3/
    // Note: blank after user implies look up authorized user
    try {
        // tslint:disable-next-line:no-unsafe-any
        const gitHubResponse: Response = await request(requestOptions).promise();
        if (gitHubResponse.headers.link) {
            const link: string = <string>gitHubResponse.headers.link;
            // regex to find the next and last links in the string
            const linkUrls: string[] = link.match(/https\:\/\/[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,3}(\/\S*)?[0-9]/g);
            requestOptions.nextLink = linkUrls[0];
            requestOptions.lastLink = linkUrls[1];
        }
        // tslint:disable-next-line:no-unsafe-any
        return <Object[]>JSON.parse(gitHubResponse.body);
    } catch (error) {
        const parsedError: IParsedError = parseError(error);
        if (parsedError.message.indexOf('Bad credentials') > -1) {
            // the default error is just "Bad Credentials," which is an unhelpful error message
            const tokenExpired: string = localize('tokenExpired', 'Azure\'s GitHub token has expired.  Reauthorize in the Portal under "Deployment options."');
            const goToPortal: string = localize('goToPortal', 'Go to Portal');
            const input: string | undefined = await vscode.window.showErrorMessage(tokenExpired, goToPortal);
            if (input === goToPortal) {
                node.openInPortal();
                // https://github.com/Microsoft/vscode-azuretools/issues/78
                throw new UserCancelledError();
            } else {
                throw new UserCancelledError();
            }
        } else {
            throw error;
        }
    }
}

/**
 * @param label Property of JSON that will be used as the QuickPicks label
 * @param description Optional property of JSON that will be used as QuickPicks description
 * @param data Optional property of JSON that will be used as QuickPicks data saved as a NameValue pair
 * @param quickPicks Optional property of QuickPickItems array that will be added to rather than returning a new one (side-effect)
 */
function createQuickPickFromJsons(jsons: Object[], label: string, description?: string, data?: string[], quickPicks?: IAzureQuickPickItem<{}>[]): IAzureQuickPickItem<{}>[] {
    const returnQuickPicks: IAzureQuickPickItem<{}>[] = quickPicks ? quickPicks : [];
    for (const json of jsons) {
        const dataValuePair: NameValuePair = {};

        if (!json[label]) {
            // skip this JSON if it doesn't have this label
            continue;
        }

        if (description && !json[description]) {
            // if the label exists, but the description does not, then description will just be left blank
            description = undefined;
        }

        if (data) {
            // construct value pair based off data labels provided
            for (const property of data) {
                // required to construct first otherwise cannot use property as key name
                dataValuePair[property] = json[property];
            }
        }

        returnQuickPicks.push({
            label: <string>json[label],
            description: `${description ? json[description] : ''}`,
            data: dataValuePair
        });
    }

    return returnQuickPicks;
}
