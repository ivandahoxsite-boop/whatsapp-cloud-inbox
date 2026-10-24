import { buildTemplateSendPayload } from '@kapso/whatsapp-cloud-api';
import type { whatsappClient } from '@/lib/whatsapp-client';
import type { TemplateParameterInfo } from '@/types/whatsapp';

type TemplateSendInput = Parameters<typeof buildTemplateSendPayload>[0];
type TemplateMessageInput = Parameters<(typeof whatsappClient.messages)['sendTemplate']>[0];
export type TemplatePayload = TemplateMessageInput['template'];
type TemplateBodyParameter = NonNullable<TemplateSendInput['body']>[number];
type TemplateHeaderParameter = Extract<NonNullable<TemplateSendInput['header']>, { type: 'text' }>;
type TemplateButtonParameter = Extract<NonNullable<TemplateSendInput['buttons']>[number], { subType: 'url' }>;
type ButtonTextParameter = { type: 'text'; text: string; parameter_name?: string };

/** Turns the user's parameter values into the payload Kapso expects. Shared by the inbox and the campaigns. */
export function buildTemplatePayload(
  templateName: string,
  languageCode: string,
  parameters: string[] | Record<string, string> | undefined,
  parameterInfo: TemplateParameterInfo | undefined
): TemplatePayload {
  const templateOptions: TemplateSendInput = {
    name: templateName,
    language: languageCode
  };

  if (parameters && parameterInfo) {
    const typedParamInfo = parameterInfo as TemplateParameterInfo;

    const bodyParameters: TemplateBodyParameter[] = [];
    const buttonParameters: TemplateButtonParameter[] = [];
    let headerParameter: TemplateHeaderParameter | undefined;

    const getParameterValue = (paramName: string, index: number) => {
      if (Array.isArray(parameters)) {
        return parameters[index];
      }
      return parameters[paramName];
    };

    typedParamInfo.parameters.forEach((paramDef, index) => {
      const rawValue = getParameterValue(paramDef.name, index);
      if (rawValue === undefined || rawValue === null) {
        return;
      }

      const textValue = String(rawValue);
      if (!textValue.trim()) {
        return;
      }

      if (paramDef.component === 'HEADER') {
        if (!headerParameter) {
          headerParameter = {
            type: 'text',
            text: textValue,
            parameter_name: paramDef.name
          } as TemplateHeaderParameter;
        }
        return;
      }

      if (paramDef.component === 'BODY') {
        bodyParameters.push({
          type: 'text',
          text: textValue,
          parameter_name: paramDef.name
        } as TemplateBodyParameter);
        return;
      }

      if (paramDef.component === 'BUTTON' && typeof paramDef.buttonIndex === 'number') {
        let button = buttonParameters.find((btn) => btn.index === paramDef.buttonIndex);
        if (!button) {
          button = {
            type: 'button',
            subType: 'url',
            index: paramDef.buttonIndex,
            parameters: []
          } as TemplateButtonParameter;
          buttonParameters.push(button);
        }

        button.parameters.push({
          type: 'text',
          text: textValue,
          parameter_name: paramDef.name
        } as ButtonTextParameter);
      }
    });

    if (headerParameter) {
      templateOptions.header = headerParameter;
    }

    if (bodyParameters.length > 0) {
      templateOptions.body = bodyParameters;
    }

    if (buttonParameters.length > 0) {
      templateOptions.buttons = buttonParameters;
    }
  }

  return buildTemplateSendPayload(templateOptions) as TemplatePayload;
}
