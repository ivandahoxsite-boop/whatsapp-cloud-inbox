import { NextResponse } from 'next/server';
import { importSales, type ImportTarget } from '@/lib/crm/customers';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const { columns, mapping, rows } = (await request.json()) as {
      columns: string[];
      mapping: Record<string, ImportTarget>;
      rows: string[][];
    };
    if (!Array.isArray(columns) || !Array.isArray(rows)) throw new Error('Datos de importación inválidos');
    return NextResponse.json(importSales(columns, mapping, rows));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 400 });
  }
}
