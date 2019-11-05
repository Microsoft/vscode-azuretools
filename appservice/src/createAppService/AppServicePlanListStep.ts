/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebSiteManagementClient } from 'azure-arm-website';
import { AppServicePlan } from 'azure-arm-website/lib/models';
import { AzureWizardPromptStep, createAzureClient, IAzureQuickPickItem, IAzureQuickPickOptions, IWizardOptions, LocationListStep, ResourceGroupListStep } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { localize } from '../localize';
import { nonNullProp } from '../utils/nonNull';
import { uiUtils } from '../utils/uiUtils';
import { getWebsiteOSDisplayName, WebsiteOS } from './AppKind';
import { AppServicePlanCreateStep } from './AppServicePlanCreateStep';
import { AppServicePlanNameStep } from './AppServicePlanNameStep';
import { AppServicePlanSkuStep } from './AppServicePlanSkuStep';
import { IAppServiceWizardContext } from './IAppServiceWizardContext';

export class AppServicePlanListStep extends AzureWizardPromptStep<IAppServiceWizardContext> {
    public static async getPlans(wizardContext: IAppServiceWizardContext): Promise<AppServicePlan[]> {
        if (wizardContext.plansTask === undefined) {
            const client: WebSiteManagementClient = createAzureClient(wizardContext, WebSiteManagementClient);
            wizardContext.plansTask = uiUtils.listAll(client.appServicePlans, client.appServicePlans.list());
        }

        return await wizardContext.plansTask;
    }

    public static async isNameAvailable(wizardContext: IAppServiceWizardContext, name: string, resourceGroupName: string): Promise<boolean> {
        const plans: AppServicePlan[] = await AppServicePlanListStep.getPlans(wizardContext);
        return !plans.some((plan: AppServicePlan) =>
            nonNullProp(plan, 'resourceGroup').toLowerCase() === resourceGroupName.toLowerCase() &&
            nonNullProp(plan, 'name').toLowerCase() === name.toLowerCase()
        );
    }

    public async prompt(wizardContext: IAppServiceWizardContext): Promise<void> {
        // Cache hosting plan separately per subscription
        const options: IAzureQuickPickOptions = { placeHolder: localize('selectPlan', 'Select a {0} App Service plan.', getWebsiteOSDisplayName(nonNullProp(wizardContext, 'newSiteOS'))), id: `AppServicePlanListStep/${wizardContext.subscriptionId}` };
        wizardContext.plan = (await ext.ui.showQuickPick(this.getQuickPicks(wizardContext), options)).data;

        wizardContext.telemetry.properties.newPlan = String(!wizardContext.plan);
        if (wizardContext.plan) {
            await LocationListStep.setLocation(wizardContext, wizardContext.plan.location);
        }
    }

    public async getSubWizard(wizardContext: IAppServiceWizardContext): Promise<IWizardOptions<IAppServiceWizardContext> | undefined> {
        if (!wizardContext.plan) {
            const promptSteps: AzureWizardPromptStep<IAppServiceWizardContext>[] = [new AppServicePlanNameStep(), new AppServicePlanSkuStep(), new ResourceGroupListStep()];
            LocationListStep.addStep(wizardContext, promptSteps);
            return {
                promptSteps: promptSteps,
                executeSteps: [new AppServicePlanCreateStep()]
            };
        } else {
            return undefined;
        }
    }

    public shouldPrompt(wizardContext: IAppServiceWizardContext): boolean {
        return !wizardContext.plan && !wizardContext.newPlanName;
    }

    private async getQuickPicks(wizardContext: IAppServiceWizardContext): Promise<IAzureQuickPickItem<AppServicePlan | undefined>[]> {
        const picks: IAzureQuickPickItem<AppServicePlan | undefined>[] = [{
            label: localize('CreateNewAppServicePlan', '$(plus) Create new App Service plan'),
            description: '',
            data: undefined
        }];

        let plans: AppServicePlan[] = await AppServicePlanListStep.getPlans(wizardContext);
        const famFilter: RegExp | undefined = wizardContext.planSkuFamilyFilter;
        if (famFilter) {
            plans = plans.filter(plan => !plan.sku || !plan.sku.family || famFilter.test(plan.sku.family));
        }

        for (const plan of plans) {
            const isNewSiteLinux: boolean = wizardContext.newSiteOS === WebsiteOS.linux;
            let isPlanLinux: boolean = nonNullProp(plan, 'kind').toLowerCase().includes(WebsiteOS.linux);

            if (plan.sku && plan.sku.family === 'EP') {
                // elastic premium plans do not have the os in the kind, so we have to check the "reserved" property
                const client: WebSiteManagementClient = createAzureClient(wizardContext, WebSiteManagementClient);
                const epPlan: AppServicePlan = await client.appServicePlans.get(nonNullProp(plan, 'resourceGroup'), nonNullProp(plan, 'name'));
                isPlanLinux = !!epPlan.reserved;
            }

            // plan.kind will contain "linux" for Linux plans, but will _not_ contain "windows" for Windows plans. Thus we check "isLinux" for both cases
            if (isNewSiteLinux === isPlanLinux) {
                picks.push({
                    id: plan.id,
                    label: nonNullProp(plan, 'name'),
                    description: `${nonNullProp(plan, 'sku').name} (${plan.geoRegion})`,
                    detail: plan.resourceGroup,
                    data: plan
                });
            }
        }

        return picks;
    }
}
