/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import * as escape from 'escape-string-regexp';
import { IParsedError } from "../index";
import { parseError } from "./parseError";

export async function callWithMaskHandling<T>(callback: () => Promise<T>, valueToMask: string): Promise<T> {
    try {
        return await callback();
    } catch (error) {
        const parsedError: IParsedError = parseError(error);

        if (parsedError.isUserCancelledError) {
            throw error;
        }

        const maskedMessage: string = valueToMask ?
            parsedError.message.replace(new RegExp(escape(valueToMask), 'g'), '***') :
            parsedError.message;
        throw new Error(maskedMessage);
    }
}
