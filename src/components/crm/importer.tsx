'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseCsv } from '@/lib/crm/csv';
import type { CustomField } from '@/lib/crm/db';
import { QUERY_KEY, api, type CrmData } from './shared';

// ---- Import ----------------------------------------------------------------

const BASE_TARGETS: { value: string; label: string }[] = [
  { value: 'ignore', label: '— Ignorar —' },
  { value: 'phone', label: 'Teléfono *' },
  { value: 'sold_at', label: 'Fecha de venta *' },
  { value: 'name', label: 'Nombre del cliente' },
  { value: 'city', label: 'Ciudad' },
  { value: 'tags', label: 'Etiquetas (separadas por coma)' },
  { value: 'amount', label: 'Monto' },
  { value: 'product', label: 'Producto' }
];

function guessTarget(header: string): string {
  const h = header.toLowerCase();
  if (/tel|phone|cel|whats|móvil|movil/.test(h)) return 'phone';
  if (/ciudad|city|municipio|localidad/.test(h)) return 'city';
  if (/etiqueta|tag|categor/.test(h)) return 'tags';
  if (/fecha|date/.test(h)) return 'sold_at';
  if (/nombre|name|cliente/.test(h)) return 'name';
  if (/monto|total|importe|amount|precio|valor/.test(h)) return 'amount';
  if (/producto|product|art[ií]culo|item|servicio/.test(h)) return 'product';
  return 'ignore';
}

function downloadTemplate() {
  const csv =
    '\uFEFFtelefono,nombre,ciudad,fecha,monto,producto,etiquetas\n' +
    '573001234567,Ana Pérez,Bogotá,15/03/2026,120000,Plan mensual,"VIP, Referido"\n' +
    '573109876543,Luis Gómez,Medellín,02/04/2026,85000,Kit básico,Mayorista\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plantilla-ventas.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export function Importer({ data, onDone }: { data: CrmData; onDone: () => void }) {
  const qc = useQueryClient();
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; skipped?: { row: number; reason: string }[] } | null>(null);

  const onFile = async (file: File) => {
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setMsg({ ok: false, text: 'El archivo está vacío o no es un CSV válido.' });
    const [head, ...body] = parsed;
    setColumns(head);
    setRows(body);
    setMapping(Object.fromEntries(head.map((h) => [h, guessTarget(h)])));
    setMsg(null);
  };

  const targetsFor = (header: string) => {
    const customs = data.fields.map((f) => ({ value: `${f.entity}:${f.key}`, label: `${f.entity === 'contact' ? 'Cliente' : 'Venta'}: ${f.label}` }));
    return [
      ...BASE_TARGETS,
      ...customs,
      { value: `new_contact:${header}`, label: `+ Nuevo campo de cliente “${header}”` },
      { value: `new_sale:${header}`, label: `+ Nuevo campo de venta “${header}”` }
    ];
  };

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      // Create any new custom fields requested in the mapping first.
      const final: Record<string, string> = {};
      for (const col of columns) {
        const t = mapping[col] ?? 'ignore';
        if (t.startsWith('new_')) {
          const entity = t.startsWith('new_contact') ? 'contact' : 'sale';
          const { field } = await api<{ field: CustomField }>('/api/crm/fields', 'POST', { entity, label: col });
          final[col] = `${entity}:${field.key}`;
        } else final[col] = t;
      }
      const r = await api<{ rows: number; salesCreated: number; contactsCreated: number; contactsUpdated: number; skipped: { row: number; reason: string }[] }>(
        '/api/crm/import',
        'POST',
        { columns, mapping: final, rows }
      );
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
      setMsg({
        ok: true,
        text: `${r.salesCreated} ventas importadas · ${r.contactsCreated} clientes nuevos · ${r.contactsUpdated} actualizados · ${r.skipped.length} filas omitidas`,
        skipped: r.skipped
      });
      if (r.skipped.length === 0) setTimeout(onDone, 1200);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sube un CSV con tus ventas pasadas (una fila por venta). Necesita al menos <b>teléfono</b> y <b>fecha</b>. Si un teléfono ya existe, la venta se suma a ese cliente.
        Fechas: <code>2024-03-15</code> o <code>15/03/2024</code>. También puedes incluir <b>ciudad</b> y <b>etiquetas</b> (separadas por coma).
      </p>
      <button onClick={downloadTemplate} className="block text-sm text-primary underline">
        Descargar plantilla de ejemplo (CSV)
      </button>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
        <Upload className="h-4 w-4" /> Elegir archivo CSV
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>

      {columns.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2">Columna del archivo</th>
                  <th className="p-2">Ejemplo</th>
                  <th className="p-2">Guardar como</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col, i) => (
                  <tr key={col + i} className="border-t">
                    <td className="p-2 font-medium">{col}</td>
                    <td className="max-w-48 truncate p-2 text-muted-foreground">{rows[0]?.[i]}</td>
                    <td className="p-2">
                      <select
                        className="h-8 rounded-md border bg-transparent px-1 text-sm"
                        value={mapping[col]}
                        onChange={(e) => setMapping({ ...mapping, [col]: e.target.value })}
                      >
                        {targetsFor(col).map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Importando…' : `Importar ${rows.length} filas`}
          </Button>
        </>
      )}

      {msg && (
        <div className={msg.ok ? 'text-sm' : 'text-sm text-destructive'}>
          <p>{msg.text}</p>
          {msg.skipped && msg.skipped.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-muted-foreground">
              {msg.skipped.slice(0, 50).map((s) => (
                <li key={s.row}>
                  Fila {s.row}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
