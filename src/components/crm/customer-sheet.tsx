'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, ShoppingBag, StickyNote, Trash2, ArrowRightLeft, Tag as TagIcon, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RECURRENCE_INFO } from '@/lib/crm/scoring';
import type { Customer } from '@/lib/crm/customers';
import type { CustomField } from '@/lib/crm/db';
import { QUERY_KEY, RecurrencePill, SegmentPill, TagPill, ago, api, cityOptions, formatPhone, money, relativeDays, type CrmData } from './shared';

type Sale = { id: number; soldAt: string; amount: number; product: string };
type Activity = { id: number; kind: string; text: string; createdAt: string };
type Detail = { sales: Sale[]; activities: Activity[] };

const fmtDate = (iso: string) =>
  new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso.replace(' ', 'T') + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function NextPurchase({ c }: { c: Customer }) {
  if (!c.nextExpectedAt || c.overdueDays == null) return <span className="text-muted-foreground">Necesita 2+ compras</span>;
  if (c.overdueDays > 0) return <span className="text-amber-500">{fmtDate(c.nextExpectedAt)} · {c.overdueDays} d de retraso</span>;
  return <span>{fmtDate(c.nextExpectedAt)} · en {-c.overdueDays} d</span>;
}

export function CustomerSheet({ customerId, data, onClose }: { customerId: number | null; data: CrmData; onClose: () => void }) {
  const c = data.customers.find((x) => x.id === customerId) ?? null;
  return (
    <Dialog open={!!c} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton={false}
        // Don't focus the name input on open: on phones that pops the keyboard over the sheet.
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="left-auto right-0 top-0 block h-[100dvh] max-h-[100dvh] max-w-full translate-x-0 translate-y-0 overflow-y-auto rounded-none border-l p-0 sm:max-w-md sm:p-0"
      >
        {c && <SheetBody key={c.id} c={c} data={data} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function SheetBody({ c, data, onClose }: { c: Customer; data: CrmData; onClose: () => void }) {
  const qc = useQueryClient();
  const detailKey = ['crm-customer', c.id];
  const { data: detail } = useQuery({ queryKey: detailKey, queryFn: () => api<Detail>(`/api/crm/customers/${c.id}`) });
  const [err, setErr] = useState('');
  const [name, setName] = useState(c.name);
  const [city, setCity] = useState(c.city);
  const [newTag, setNewTag] = useState('');
  const [note, setNote] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: QUERY_KEY }), qc.invalidateQueries({ queryKey: detailKey })]);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const patch = (body: Record<string, unknown>) => run(() => api('/api/crm/customers', 'PATCH', { id: c.id, ...body }));
  const tagById = new Map(data.tags.map((t) => [t.id, t]));
  const contactFields = data.fields.filter((f) => f.entity === 'contact');

  const addTag = (tagName: string) => {
    if (!tagName.trim()) return;
    setNewTag('');
    run(() => api('/api/crm/customers/bulk', 'POST', { ids: [c.id], addTags: [tagName.trim()] }));
  };

  const timeline = [
    ...(detail?.sales ?? []).map((s) => ({
      key: `s${s.id}`,
      at: `${s.soldAt}T12:00:00`,
      icon: ShoppingBag,
      color: '#34d399',
      title: `Compra${s.product ? ` · ${s.product}` : ''}`,
      text: money(s.amount),
      withTime: false
    })),
    ...(detail?.activities ?? []).map((a) => ({
      key: `a${a.id}`,
      at: a.createdAt.replace(' ', 'T') + 'Z',
      icon: a.kind === 'note' ? StickyNote : a.kind.startsWith('whatsapp') ? MessageCircle : a.kind === 'tags' ? TagIcon : ArrowRightLeft,
      color: a.kind === 'whatsapp_in' ? '#38bdf8' : a.kind === 'whatsapp_out' ? '#a78bfa' : a.kind === 'note' ? '#fbbf24' : '#a1a1aa',
      title: a.kind === 'whatsapp_in' ? 'Escribió' : a.kind === 'whatsapp_out' ? 'Le escribiste' : a.kind === 'note' ? 'Nota' : 'Cambio',
      text: a.text,
      withTime: true
    }))
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/90 p-4 pr-14 backdrop-blur-xl">
        <button
          onClick={onClose}
          aria-label="Cerrar ficha"
          className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
        <DialogTitle asChild>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== c.name && patch({ name })}
            placeholder="Sin nombre"
            className="w-full bg-transparent text-lg font-semibold outline-none"
          />
        </DialogTitle>
        <DialogDescription className="text-xs">{formatPhone(c.phone)}</DialogDescription>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <RecurrencePill recurrence={c.recurrence} />
          <SegmentPill segment={c.segment} />
          <span className="text-xs text-muted-foreground">Potencial {c.score}/100</span>
        </div>
        {c.hasPhone ? (
          <a
            href={`https://wa.me/${c.phone}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-emerald-500/15 px-4 text-sm font-medium text-emerald-500 hover:bg-emerald-500/25"
          >
            <MessageCircle className="h-4 w-4" /> Escribir por WhatsApp
          </a>
        ) : (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newPhone.trim()) return;
              // If this number already has a WhatsApp chat, both are merged and this sheet closes.
              run(async () => {
                const r = await api<{ merged: boolean }>('/api/crm/customers', 'PATCH', { id: c.id, phone: newPhone.trim() });
                setNewPhone('');
                if (r.merged) onClose();
              });
            }}
          >
            <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Agregar teléfono" inputMode="tel" className="h-9" />
            <Button type="submit" size="sm">Guardar</Button>
          </form>
        )}
      </div>

      <div className="space-y-5 p-4">
        {c.awaitingReply && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm">
            <p className="text-xs font-medium text-amber-500">⏳ Te escribió {ago(c.lastInboundAt)} y aún no le respondes</p>
            <p className="mt-1 whitespace-pre-wrap break-words">“{c.lastInboundText}”</p>
          </div>
        )}
        <p className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">{RECURRENCE_INFO[c.recurrence].hint}</p>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="Compras" value={String(c.salesCount)} />
          <Stat label="Total" value={money(c.totalSpent)} />
          <Stat label="Ticket promedio" value={c.salesCount ? money(c.avgTicket) : '—'} />
          <Stat label="Última compra" value={relativeDays(c.daysSinceLastSale)} />
          <Stat label="Compra cada" value={c.avgIntervalDays != null ? `~${c.avgIntervalDays} días` : '—'} />
          <Stat label="Producto favorito" value={c.favoriteProduct ?? '—'} />
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Próxima compra esperada</dt>
            <dd className="font-medium">
              <NextPurchase c={c} />
            </dd>
          </div>
          {c.firstSaleAt && <Stat label="Cliente desde" value={fmtDate(c.firstSaleAt)} />}
          <Stat label="Te escribió" value={ago(c.lastInboundAt)} />
          <Stat label="Le escribiste" value={ago(c.lastOutboundAt)} />
        </dl>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Datos</h3>
          <label className="block text-xs text-muted-foreground">
            Ciudad
            <Input
              list="crm-cities"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={() => city !== c.city && patch({ city })}
              placeholder="Ej: Bogotá"
              className="mt-1"
            />
            <datalist id="crm-cities">
              {cityOptions(data.customers).map((o) => (
                <option key={o.name} value={o.name} />
              ))}
            </datalist>
          </label>
          <label className="block text-xs text-muted-foreground">
            Etapa
            <select
              value={c.stageId ?? ''}
              onChange={(e) => patch({ stageId: e.target.value ? Number(e.target.value) : null })}
              className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm text-foreground"
            >
              <option value="">Sin etapa</option>
              {data.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {contactFields.map((f) => (
            <CustomFieldInput key={f.id} field={f} value={String(c.data[f.key] ?? '')} onSave={(v) => patch({ data: { [f.key]: v } })} />
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Etiquetas</h3>
          <div className="flex flex-wrap gap-1.5">
            {c.tags.length === 0 && <span className="text-xs text-muted-foreground">Sin etiquetas</span>}
            {c.tags.map((id) => {
              const t = tagById.get(id);
              return t ? (
                <TagPill key={id} tag={t} onRemove={() => run(() => api('/api/crm/customers/bulk', 'POST', { ids: [c.id], removeTagIds: [id] }))} />
              ) : null;
            })}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addTag(newTag);
            }}
          >
            <Input list="crm-tags" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nueva etiqueta (ej: VIP, Mayorista)" />
            <datalist id="crm-tags">
              {data.tags.map((t) => (
                <option key={t.id} value={t.name} />
              ))}
            </datalist>
            <Button type="submit" size="sm" variant="outline" className="h-9">
              Añadir
            </Button>
          </form>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nota</h3>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Ej: Prefiere que le escriban en la tarde"
            className="w-full rounded-md border bg-transparent p-2 text-sm outline-none focus:border-primary/60"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!note.trim()}
            onClick={() =>
              run(async () => {
                await api(`/api/crm/customers/${c.id}`, 'POST', { note });
                setNote('');
              })
            }
          >
            Guardar nota
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Historial</h3>
          {!detail && <p className="text-xs text-muted-foreground">Cargando…</p>}
          {detail && timeline.length === 0 && <p className="text-xs text-muted-foreground">Sin actividad todavía.</p>}
          <ol className="space-y-3">
            {timeline.slice(0, 60).map((t) => (
              <li key={t.key} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: `${t.color}26`, color: t.color }}>
                  <t.icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {t.title} <span className="font-normal text-muted-foreground">· {t.withTime ? fmtDateTime(t.at) : fmtDate(t.at)}</span>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{t.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {err && <p className="text-sm text-destructive">{err}</p>}

        <Button
          variant="ghost"
          size="sm"
          className="text-destructive"
          onClick={() =>
            confirm(`¿Eliminar a ${c.name || c.phone} con todas sus ventas e historial?`) &&
            run(async () => {
              await api('/api/crm/customers', 'DELETE', { id: c.id });
              onClose();
            })
          }
        >
          <Trash2 className="h-4 w-4" /> Eliminar cliente
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function CustomFieldInput({ field, value, onSave }: { field: CustomField; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <label className="block text-xs text-muted-foreground">
      {field.label}
      {field.type === 'select' ? (
        <select
          value={v}
          onChange={(e) => {
            setV(e.target.value);
            onSave(e.target.value);
          }}
          className="mt-1 h-9 w-full rounded-md border bg-transparent px-2 text-sm text-foreground"
        >
          <option value="" />
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <Input
          className="mt-1"
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => v !== value && onSave(v)}
        />
      )}
    </label>
  );
}
