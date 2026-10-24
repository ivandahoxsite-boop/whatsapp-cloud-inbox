import { listCustomers } from '@/lib/crm/customers';
import { fail, guardAgent, json } from '@/lib/crm/agent-http';
import { RECURRENCE_INFO, SEGMENT_INFO } from '@/lib/crm/scoring';
import { matchesFilter, sanitizeFilter, type CustomerFilter } from '@/lib/crm/filters';
import { listTags } from '@/lib/crm/tags';
import { listSegments } from '@/lib/crm/segments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/agent/customers?awaiting=1&segment=dormido_valioso&recurrence=por_recomprar&city=Bogotá&tag=VIP&segment_id=3&q=ana&limit=20
export async function GET(request: Request) {
  const denied = guardAgent(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const p = (k: string) => url.searchParams.get(k) ?? undefined;
    const limit = Math.min(100, Math.max(1, Number(p('limit') || 20)));
    const tags = listTags();

    let filter: CustomerFilter = {};
    const segmentId = p('segment_id');
    if (segmentId) {
      const saved = listSegments().find((s) => s.id === Number(segmentId));
      if (!saved) return json({ error: `segment_id inválido. Opciones: ${listSegments().map((s) => `${s.id}=${s.name}`).join(', ')}` }, 400);
      filter = saved.filter;
    }
    const segment = p('segment');
    if (segment && !(segment in SEGMENT_INFO)) return json({ error: `segment inválido. Opciones: ${Object.keys(SEGMENT_INFO).join(', ')}` }, 400);
    const recurrence = p('recurrence');
    if (recurrence && !(recurrence in RECURRENCE_INFO)) return json({ error: `recurrence inválido. Opciones: ${Object.keys(RECURRENCE_INFO).join(', ')}` }, 400);
    const tagName = p('tag');
    const tag = tagName ? tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase()) : undefined;
    if (tagName && !tag) return json({ error: `Etiqueta no encontrada. Opciones: ${tags.map((t) => t.name).join(', ')}` }, 400);

    filter = sanitizeFilter({
      ...filter,
      q: p('q') ?? filter.q,
      rfm: segment ? [segment] : filter.rfm,
      recurrence: recurrence ? [recurrence] : filter.recurrence,
      cities: p('city') ? [p('city')] : filter.cities,
      tags: tag ? [tag.id] : filter.tags,
      awaiting: p('awaiting') === '1' || p('awaiting') === 'true' ? true : filter.awaiting
    });

    const tagName2 = new Map(tags.map((t) => [t.id, t.name]));
    const customers = listCustomers()
      .filter((c) => matchesFilter(c, filter))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        city: c.city,
        tags: c.tags.map((t) => tagName2.get(t)).filter(Boolean),
        stageId: c.stageId,
        segment: c.segment,
        recurrence: c.recurrence,
        score: c.score,
        salesCount: c.salesCount,
        totalSpent: c.totalSpent,
        daysSinceLastSale: c.daysSinceLastSale,
        avgIntervalDays: c.avgIntervalDays,
        nextExpectedAt: c.nextExpectedAt,
        overdueDays: c.overdueDays,
        favoriteProduct: c.favoriteProduct,
        awaitingReply: c.awaitingReply,
        lastInboundAt: c.lastInboundAt,
        lastInboundText: c.lastInboundText,
        lastOutboundAt: c.lastOutboundAt,
        data: c.data
      }));
    return json({ customers });
  } catch (e) {
    return fail(e, 500);
  }
}
