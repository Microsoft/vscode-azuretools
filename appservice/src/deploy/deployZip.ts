/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSiteManagementModels } from '@azure/arm-appservice';
import { KuduClient } from 'vscode-azurekudu';
import { createKuduClient } from '../createKuduClient';
import { SiteClient } from '../SiteClient';
import { delayFirstWebAppDeploy } from './delayFirstWebAppDeploy';
import { IDeployContext } from './IDeployContext';
import { runWithZipStream } from './runWithZipStream';
import { waitForDeploymentToComplete } from './waitForDeploymentToComplete';

export async function deployZip(context: IDeployContext, client: SiteClient, fsPath: string, aspPromise: Promise<WebSiteManagementModels.AppServicePlan | undefined>): Promise<void> {
    const kuduClient: KuduClient = await createKuduClient(client);

    await runWithZipStream(context, fsPath, client, async zipStream => {
        await kuduClient.pushDeployment.zipPushDeploy(() => zipStream, { isAsync: true, author: 'VS Code' });
    });

    await waitForDeploymentToComplete(context, client);

    // https://github.com/Microsoft/vscode-azureappservice/issues/644
    // This delay is a temporary stopgap that should be resolved with the new pipelines
    await delayFirstWebAppDeploy(client, aspPromise);
}
