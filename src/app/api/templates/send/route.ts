import { NextResponse } from 'next/server';
import { configurationErrorResponse, resolvePhoneNumberContext } from '@/lib/inbox-settings';
import { whatsappClient } from '@/lib/whatsapp-client';
import { buildTemplatePayload } from '@/lib/crm/template-payload';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { to, templateName, languageCode, parameters, parameterInfo, phoneNumberId: requestedPhoneNumberId } = body;
    const phoneNumber = await resolvePhoneNumberContext(requestedPhoneNumberId);
    const phoneNumberId = phoneNumber.phone_number_id;

    if (!to || !templateName || !languageCode) {
      return NextResponse.json(
        { error: 'Missing required fields: to, templateName, languageCode' },
        { status: 400 }
      );
    }

    const templatePayload = buildTemplatePayload(templateName, languageCode, parameters, parameterInfo);

    // Send template message
    const result = await whatsappClient.messages.sendTemplate({
      phoneNumberId,
      to,
      template: templatePayload
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error sending template:', error);
    return configurationErrorResponse(error);
  }
}
