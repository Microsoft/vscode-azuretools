/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext } from 'vscode-azureextensionui';
import { SiteClient } from '../SiteClient';
import { DeploymentsTreeItem } from '../tree/DeploymentsTreeItem';
import { gitHubBranchData, gitHubOrgData, gitHubRepoData } from './connectToGitHub';

export interface IConnectToGitHubWizardContext extends IActionContext {
    orgData?: gitHubOrgData;
    repoData?: gitHubRepoData;
    branchData?: gitHubBranchData;
    client?: SiteClient;
    node?: DeploymentsTreeItem;
}
