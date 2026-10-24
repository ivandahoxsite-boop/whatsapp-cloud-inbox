import type { Customer } from './customers';

const money = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 0, useGrouping: 'always' });

export type Action = { customer: Customer; title: string; reason: string; message: string; priority: number };

// Rule-based "next best action" list. No external AI: it ranks customers by
// the money and urgency behind each segment so the day starts with a clear queue.
export function buildActions(customers: Customer[]): Action[] {
  // " Ana" or "" so greetings read "Hola Ana," or "Hola," for customers without a name.
  const first = (c: Customer) => (c.name.trim() ? ` ${c.name.trim().split(' ')[0]}` : '');
  const out: Action[] = [];
  for (const c of customers) {
    if (!c.hasPhone) continue; // nothing to write to yet
    if (c.recurrence === 'por_recomprar') {
      const product = c.favoriteProduct ? ` tu ${c.favoriteProduct}` : '';
      out.push({
        customer: c,
        title: 'Le toca recomprar',
        reason: `Compra cada ~${c.avgIntervalDays} días y lleva ${c.overdueDays} días de retraso${c.favoriteProduct ? ` · suele llevar ${c.favoriteProduct}` : ''}`,
        message: `Hola${first(c)}, ¿cómo vas? Ya casi es momento de renovar${product}. ¿Te lo preparo?`,
        // Predictable revenue: rank above the rest at equal value.
        priority: c.avgTicket * 1.5 + c.totalSpent
      });
      continue;
    }
    if (c.segment === 'dormido_valioso')
      out.push({
        customer: c,
        title: 'Reactivar cliente valioso',
        reason: `Gastó ${money(c.totalSpent)} y lleva ${c.daysSinceLastSale} días sin comprar`,
        message: `Hola${first(c)}, hace tiempo que no hablamos. Tenemos novedades que creemos que te van a gustar. ¿Te cuento?`,
        priority: c.totalSpent
      });
    else if (c.segment === 'en_riesgo')
      out.push({
        customer: c,
        title: 'Evitar que se enfríe',
        reason: `${c.salesCount} compras, la última hace ${c.daysSinceLastSale} días`,
        message: `Hola${first(c)}, ¿cómo te fue con tu última compra? Me encantaría ayudarte con lo siguiente.`,
        priority: c.totalSpent * 0.8
      });
    else if (c.segment === 'potencial' && (c.daysSinceLastSale ?? 99) <= 30)
      out.push({
        customer: c,
        title: 'Seguimiento de compra reciente',
        reason: `Compró hace ${c.daysSinceLastSale} días: buen momento para ofrecer algo más`,
        message: `Hola${first(c)}, gracias por tu compra. ¿Quieres que te muestre algo que combina con ella?`,
        priority: c.avgTicket
      });
    else if (c.segment === 'campeon')
      out.push({
        customer: c,
        title: 'Ofrecer algo premium',
        reason: `Tus mejores clientes: ${c.salesCount} compras, ${money(c.totalSpent)} en total`,
        message: `Hola${first(c)}, queremos darte acceso anticipado a lo nuevo. ¿Te interesa?`,
        priority: c.totalSpent * 0.5
      });
  }
  return out.sort((a, b) => b.priority - a.priority).slice(0, 6);
}
