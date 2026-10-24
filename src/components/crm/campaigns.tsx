'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Campaign, CampaignItem } from '@/lib/crm/campaigns';
import type { CustomerFilter } from '@/lib/crm/filters';
import type { Template, TemplateParameterInfo } from '@/types/whatsapp';
import { getTemplateParameters } from '@/lib/template-parser';
import { fillTemplate } from '@/lib/crm/campaigns-text';
import { api, card, formatPhone, type CrmData } from './shared';

const STATUS_LABEL: Record<Campaign['status'], string> = { draft: 'Borrador', running: 'En curso', done: 'Terminada', cancelled: 'Cancelada' };
const ITEM_LABEL: Record<CampaignItem['status'], string> = { pending: 'Pendiente', sent: 'Enviado', failed: 'Falló', excluded: 'Quitado' };
const select = 'h-9 w-full rounded-md border bg-transparent px-2 text-sm';

const PRESETS: { label: string; filter: CustomerFilter }[] = [
  { label: 'Les toca recomprar', filter: { recurrence: ['por_recomprar'] } },
  { label: 'Dormidos valiosos', filter: { rfm: ['dormido_valioso'] } },
  { label: 'En riesgo', filter: { rfm: ['en_riesgo'] } },
  { label: 'Campeones', filter: { rfm: ['campeon'] } }
];

const bodyOf = (t: Template) => t.components?.find((c) => c.type === 'BODY')?.text ?? '';

export function Campaigns({ data }: { data: CrmData }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: list } = useQuery({ queryKey: ['crm-campaigns'], queryFn: () => api<{ campaigns: Campaign[] }>('/api/crm/campaigns') });

  if (openId) return <CampaignDetail id={openId} onBack={() => setOpenId(null)} />;
  if (creating)
    return (
      <NewCampaign
        data={data}
        onCancel={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          setOpenId(id);
        }}
      />
    );

  const campaigns = list?.campaigns ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Envía una plantilla de WhatsApp a un grupo de clientes. Primero ves la lista; solo sale cuando tú la inicias.
        </p>
        <Button onClick={() => setCreating(true)}>Nueva campaña</Button>
      </div>
      {campaigns.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay campañas.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {campaigns.map((c) => (
          <li key={c.id}>
            <button onClick={() => setOpenId(c.id)} className={cn(card, 'block w-full text-left hover:bg-card/80')}>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-medium">{c.name}</p>
                <Badge variant="outline">{STATUS_LABEL[c.status]}</Badge>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">Plantilla {c.templateName}</p>
              <p className="mt-2 text-xs">
                {c.counts.sent} enviados · {c.counts.pending} pendientes
                {c.counts.failed ? ` · ${c.counts.failed} fallaron` : ''}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NewCampaign({ data, onCancel, onCreated }: { data: CrmData; onCancel: () => void; onCreated: (id: number) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [audience, setAudience] = useState('0');
  const [tplName, setTplName] = useState('');
  const [map, setMap] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: tpls, error: tplErr } = useQuery({
    queryKey: ['crm-templates'],
    queryFn: async () => {
      const r = await api<{ data: Template[] }>('/api/templates');
      return (r.data ?? []).filter((t) => t.status === 'APPROVED');
    }
  });
  const template = tpls?.find((t) => `${t.name}|${t.language}` === tplName);
  const info: TemplateParameterInfo | null = template ? getTemplateParameters(template) : null;
  const hasButtonVars = !!info?.parameters.some((p) => p.component === 'BUTTON');

  const audiences = [
    ...PRESETS.map((p, i) => ({ key: String(i), label: p.label, filter: p.filter })),
    ...data.segments.map((s) => ({ key: `s${s.id}`, label: `Segmento: ${s.name}`, filter: s.filter }))
  ];
  const chosen = audiences.find((a) => a.key === audience) ?? audiences[0];

  const create = async () => {
    if (!template || !info) return;
    setErr('');
    setBusy(true);
    try {
      const r = await api<{ id: number }>('/api/crm/campaigns', 'POST', {
        name,
        templateName: template.name,
        language: template.language,
        bodyText: bodyOf(template),
        parameterInfo: info,
        paramMap: info.parameters.map((_, i) => map[i] ?? ''),
        filter: chosen.filter
      });
      qc.invalidateQueries({ queryKey: ['crm-campaigns'] });
      onCreated(r.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(card, 'space-y-4')}>
      <h2 className="font-medium">Nueva campaña</h2>
      <label className="block text-xs text-muted-foreground">
        Nombre
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Recompra octubre" className="mt-1" />
      </label>
      <label className="block text-xs text-muted-foreground">
        ¿A quién?
        <select value={audience} onChange={(e) => setAudience(e.target.value)} className={cn(select, 'mt-1')}>
          {audiences.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted-foreground">
        Plantilla (solo las aprobadas por Meta)
        <select
          value={tplName}
          onChange={(e) => {
            setTplName(e.target.value);
            setMap([]);
          }}
          className={cn(select, 'mt-1')}
        >
          <option value="">Elige una…</option>
          {(tpls ?? []).map((t) => (
            <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
              {t.name} ({t.language})
            </option>
          ))}
        </select>
        {tplErr && <span className="text-destructive">{(tplErr as Error).message}</span>}
      </label>

      {template && (
        <div className="space-y-3">
          <p className="whitespace-pre-wrap rounded-md border bg-background/40 p-2 text-sm">{bodyOf(template) || '(sin texto)'}</p>
          {hasButtonVars && <p className="text-xs text-destructive">Esta plantilla tiene botones con variables: por ahora envíala desde la bandeja.</p>}
          {info?.parameters.map((p, i) => (
            <label key={p.name} className="block text-xs text-muted-foreground">
              Variable {i + 1} {p.example ? `(ej: ${p.example})` : ''}
              <Input
                list="campaign-tokens"
                value={map[i] ?? ''}
                onChange={(e) => setMap((m) => Object.assign([...m], { [i]: e.target.value }))}
                placeholder="{nombre}, {ciudad}, {producto} o texto fijo"
                className="mt-1"
              />
            </label>
          ))}
          <datalist id="campaign-tokens">
            {['{nombre}', '{ciudad}', '{producto}'].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            {'{nombre}'} es el primer nombre; {'{producto}'} el que más compra. Quien no tenga ese dato se deja fuera de la lista.
          </p>
        </div>
      )}

      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button onClick={create} disabled={busy || !name.trim() || !template || hasButtonVars}>
          {busy ? 'Armando…' : 'Armar la lista'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function CampaignDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ['crm-campaign', id],
    queryFn: () => api<{ campaign: Campaign; items: CampaignItem[] }>(`/api/crm/campaigns/${id}`),
    refetchInterval: busy ? 3000 : false
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['crm-campaign', id] }), qc.invalidateQueries({ queryKey: ['crm-campaigns'] })]);
  if (!data) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const { campaign: c, items } = data;
  const open = c.status === 'draft' || c.status === 'running';

  const send = async () => {
    if (!confirm(`¿Enviar "${c.templateName}" a ${c.counts.pending} cliente(s)? Esto sale por WhatsApp de verdad y no se puede deshacer.`)) return;
    setBusy(true);
    setMsg('');
    try {
      const r = await api<{ sent: number; failed: number; remaining: number; stopped?: string }>(`/api/crm/campaigns/${id}`, 'POST', { action: 'send' });
      setMsg(
        `Enviados: ${r.sent}${r.failed ? ` · fallaron: ${r.failed}` : ''}.` +
          (r.stopped ? ` ${r.stopped}` : r.remaining ? ` Quedan ${r.remaining}: por el límite por hora, vuelve a pulsar Enviar más tarde.` : ' Campaña terminada.')
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
    refresh();
  };
  const toggle = async (it: CampaignItem) => {
    await api(`/api/crm/campaigns/${id}`, 'PATCH', { itemId: it.id, excluded: it.status !== 'excluded' });
    refresh();
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-muted-foreground underline">
        ← Campañas
      </button>
      <div className={cn(card, 'space-y-2')}>
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate font-medium">{c.name}</h2>
          <Badge variant="outline">{STATUS_LABEL[c.status]}</Badge>
        </div>
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {items[0] ? fillTemplate(c.bodyText, c.paramInfo, items[0].params) : c.bodyText}
        </p>
        <p className="text-xs">
          {c.counts.pending} por enviar · {c.counts.sent} enviados · {c.counts.failed} fallaron · {c.counts.excluded} quitados
        </p>
        {open && (
          <>
            <p className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-500">
              Envía solo a clientes que aceptaron recibir mensajes de tu negocio: si muchos reportan spam, Meta puede limitar o bloquear tu número. Quita de la
              lista a quien no deba recibirlo.
            </p>
            <div className="flex gap-2">
              <Button onClick={send} disabled={busy || c.counts.pending === 0}>
                {busy ? 'Enviando…' : c.status === 'running' ? 'Enviar los siguientes' : 'Aprobar y enviar'}
              </Button>
              <Button variant="ghost" onClick={async () => confirm('¿Cancelar la campaña? Lo ya enviado no se deshace.') && (await api(`/api/crm/campaigns/${id}`, 'POST', { action: 'cancel' }), refresh())}>
                Cancelar campaña
              </Button>
            </div>
          </>
        )}
        {msg && <p className="text-sm">{msg}</p>}
      </div>

      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.id} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm', it.status === 'excluded' && 'opacity-50')}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {it.name || formatPhone(it.phone)} <span className="font-normal text-muted-foreground">{formatPhone(it.phone)}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">{it.status === 'failed' ? it.error : it.params.join(' · ')}</p>
            </div>
            <Badge variant="outline">{ITEM_LABEL[it.status]}</Badge>
            {open && (it.status === 'pending' || it.status === 'excluded') && (
              <Button size="sm" variant="ghost" onClick={() => toggle(it)}>
                {it.status === 'excluded' ? 'Volver a incluir' : 'Quitar'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {items.length >= 500 && <p className="text-xs text-muted-foreground">Mostrando los primeros 500 destinatarios.</p>}
    </div>
  );
}
