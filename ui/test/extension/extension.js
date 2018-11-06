/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const vscode = require('vscode');
const ui_1 = require('../../out/src/index');
const DebugReporter = require('../../out/src/DebugReporter').DebugReporter;

function activate(context) {
    const extVars = {
        context,
        reporter: new DebugReporter(),
        outputChannel: vscode.window.createOutputChannel('azureextensionui'),
        packageInfo: require('./package.json'),
        ui: new ui_1.AzureUserInput()
    };
    ui_1.registerUIExtensionVariables(extVars)
}
exports.activate = activate;

function deactivate() {
}
exports.deactivate = deactivate;
