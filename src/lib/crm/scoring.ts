export type Segment =
  | 'campeon'
  | 'leal'
  | 'potencial'
  | 'en_riesgo'
  | 'dormido_valioso'
  | 'perdido'
  | 'sin_compras';

export const SEGMENT_INFO: Record<Segment, { label: string; hint: string }> = {
  campeon: { label: 'Campeón', hint: 'Compra seguido y reciente. Ofrécele productos nuevos o premium.' },
  leal: { label: 'Leal', hint: 'Cliente estable. Buen candidato para venta cruzada.' },
  potencial: { label: 'Alto potencial', hint: 'Compró hace poco y puede crecer. Haz seguimiento ahora.' },
  en_riesgo: { label: 'En riesgo', hint: 'Compraba bien pero se enfrió. Reactívalo pronto.' },
  dormido_valioso: { label: 'Dormido valioso', hint: 'Gastó mucho y lleva tiempo sin comprar. Prioridad de reactivación.' },
  perdido: { label: 'Perdido', hint: 'Poco valor y mucho tiempo inactivo.' },
  sin_compras: { label: 'Sin compras', hint: 'Aún no tiene ventas registradas.' }
};

export type CustomerMetrics = {
  salesCount: number;
  totalSpent: number;
  avgTicket: number;
  lastSaleAt: string | null;
  daysSinceLastSale: number | null;
  r: number;
  f: number;
  m: number;
  score: number;
  segment: Segment;
};

type Raw = { salesCount: number; totalSpent: number; lastSaleAt: string | null };

// Percentile rank scoring (1-5) relative to the rest of the customer base,
// so it adapts to any business size without configuring thresholds.
function quintiles(values: number[], higherIsBetter: boolean): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  return (v: number) => {
    if (sorted.length <= 1) return 3;
    let below = 0;
    let equal = 0;
    for (const x of sorted) {
      if (x < v) below++;
      else if (x === v) equal++;
    }
    const pct = (below + equal / 2) / sorted.length; // 0..1
    const s = Math.min(5, Math.floor((higherIsBetter ? pct : 1 - pct) * 5) + 1);
    return s;
  };
}

function classify(r: number, f: number, m: number): Segment {
  if (r >= 4 && f >= 4) return 'campeon';
  if (r >= 3 && f >= 3) return 'leal';
  if (r >= 4 && f <= 2) return 'potencial';
  if (r <= 2 && m >= 4) return 'dormido_valioso';
  if (r <= 2 && f >= 3) return 'en_riesgo';
  if (r <= 2) return 'perdido';
  return 'potencial';
}

export function computeMetrics(rows: Raw[], now = new Date()): CustomerMetrics[] {
  const withSales = rows.filter((r) => r.salesCount > 0 && r.lastSaleAt);
  const days = (r: Raw) => Math.max(0, Math.floor((now.getTime() - new Date(r.lastSaleAt!).getTime()) / 86_400_000));

  const rScore = quintiles(withSales.map(days), false);
  const fScore = quintiles(withSales.map((r) => r.salesCount), true);
  const mScore = quintiles(withSales.map((r) => r.totalSpent), true);

  return rows.map((row) => {
    if (row.salesCount === 0 || !row.lastSaleAt) {
      return {
        salesCount: 0,
        totalSpent: 0,
        avgTicket: 0,
        lastSaleAt: null,
        daysSinceLastSale: null,
        r: 0,
        f: 0,
        m: 0,
        score: 0,
        segment: 'sin_compras' as const
      };
    }
    const d = days(row);
    const r = rScore(d);
    const f = fScore(row.salesCount);
    const m = mScore(row.totalSpent);
    // Weighted 0-100: recency matters most for "who can I sell to now".
    const score = Math.round(((r * 0.4 + f * 0.3 + m * 0.3) / 5) * 100);
    return {
      salesCount: row.salesCount,
      totalSpent: row.totalSpent,
      avgTicket: row.totalSpent / row.salesCount,
      lastSaleAt: row.lastSaleAt,
      daysSinceLastSale: d,
      r,
      f,
      m,
      score,
      segment: classify(r, f, m)
    };
  });
}

// ---- Recurrence ---------------------------------------------------------------
// Orthogonal to the RFM segment: answers "does this customer come back, and when is the next purchase due?"

export type Recurrence = 'prospecto' | 'primera_compra' | 'una_vez' | 'recurrente' | 'por_recomprar' | 'recurrente_perdido';

export const RECURRENCE_INFO: Record<Recurrence, { label: string; hint: string }> = {
  prospecto: { label: 'Prospecto', hint: 'Todavía no ha comprado.' },
  primera_compra: { label: 'Primera compra', hint: 'Compró una vez hace poco. Momento ideal para lograr la segunda compra.' },
  una_vez: { label: 'Compró una vez', hint: 'Compró una sola vez y no volvió. Ofrécele una razón para regresar.' },
  recurrente: { label: 'Recurrente', hint: 'Compra de forma repetida y está al día.' },
  por_recomprar: { label: 'Le toca recomprar', hint: 'Ya pasó su ritmo habitual de compra. Escríbele ahora.' },
  recurrente_perdido: { label: 'Recurrente perdido', hint: 'Compraba seguido pero lleva mucho más de lo normal sin volver.' }
};

export type RecurrenceMetrics = {
  firstSaleAt: string | null;
  /** Average days between purchases (null with fewer than 2 purchase days). */
  avgIntervalDays: number | null;
  /** Expected date of the next purchase, from the customer's own rhythm. */
  nextExpectedAt: string | null;
  /** Positive when the expected purchase is late, negative when it is still ahead. */
  overdueDays: number | null;
  recurrence: Recurrence;
  favoriteProduct: string | null;
};

const DAY = 86_400_000;
const FIRST_PURCHASE_WINDOW = 90; // days a single purchase still counts as "recent"
const MIN_INTERVAL = 30; // floor so customers who buy twice in one week are not flagged as late after 10 days

export function computeRecurrence(
  sales: { soldAt: string; product: string; amount: number }[],
  now = new Date()
): RecurrenceMetrics {
  if (sales.length === 0) {
    return { firstSaleAt: null, avgIntervalDays: null, nextExpectedAt: null, overdueDays: null, recurrence: 'prospecto', favoriteProduct: null };
  }
  const days = [...new Set(sales.map((s) => s.soldAt.slice(0, 10)))].sort();
  const first = days[0];
  const last = days[days.length - 1];
  const sinceLast = Math.max(0, Math.floor((now.getTime() - Date.parse(last)) / DAY));

  const byProduct = new Map<string, number>();
  for (const s of sales) if (s.product) byProduct.set(s.product, (byProduct.get(s.product) ?? 0) + 1);
  const favoriteProduct = [...byProduct.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  if (days.length < 2) {
    return {
      firstSaleAt: first,
      avgIntervalDays: null,
      nextExpectedAt: null,
      overdueDays: null,
      recurrence: sinceLast <= FIRST_PURCHASE_WINDOW ? 'primera_compra' : 'una_vez',
      favoriteProduct
    };
  }

  const avg = Math.round((Date.parse(last) - Date.parse(first)) / DAY / (days.length - 1));
  const rhythm = Math.max(MIN_INTERVAL, avg);
  const next = new Date(Date.parse(last) + rhythm * DAY).toISOString().slice(0, 10);
  const overdue = sinceLast - rhythm;
  const recurrence: Recurrence = sinceLast <= rhythm * 1.5 ? 'recurrente' : sinceLast <= rhythm * 3 ? 'por_recomprar' : 'recurrente_perdido';
  return { firstSaleAt: first, avgIntervalDays: avg, nextExpectedAt: next, overdueDays: overdue, recurrence, favoriteProduct };
}
