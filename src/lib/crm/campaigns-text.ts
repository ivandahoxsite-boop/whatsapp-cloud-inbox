import type { TemplateParameterInfo } from '@/types/whatsapp';

/** Template text with the recipient's values filled in, for previews and the chat timeline. */
export function fillTemplate(bodyText: string, info: TemplateParameterInfo, values: string[]): string {
  const body = info.parameters.filter((p) => p.component === 'BODY');
  let out = bodyText;
  body.forEach((p, i) => {
    out = out.replaceAll(`{{${p.name}}}`, values[i] ?? '').replaceAll(`{{${i + 1}}}`, values[i] ?? '');
  });
  return out;
}
