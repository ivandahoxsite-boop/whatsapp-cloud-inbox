'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CustomerFilter } from '@/lib/crm/filters';
import { Pill, QUERY_KEY, api, type CrmData } from './shared';

type Tag = CrmData['tags'][number];

/**
 * The "Etiquetas" cell of the customer list (user's request, 5-nov-2026): tapping a tag filters the list by it (tap
 * again to remove the filter), and "＋" opens every tag with a checkbox to put or take it off this customer right
 * there, or to create a new one. Clicks never reach the row, so the customer file does not open.
 */
export function TagCell({
  customerId,
  tagIds,
  tags,
  filter,
  setFilter
}: {
  customerId: number;
  tagIds: number[];
  tags: Tag[];
  filter: CustomerFilter;
  setFilter: (f: CustomerFilter) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // What the checkboxes show right away, before the CRM answers (back to the real tags once it did, or on an error).
  const [shown, setShown] = useState<Set<number> | null>(null);
  const has = shown ?? new Set(tagIds);
  const active = new Set(filter.tags ?? []);
  const byId = new Map(tags.map((t) => [t.id, t]));
  const mine = tagIds.map((id) => byId.get(id)).filter((t): t is Tag => !!t);

  // The menu is drawn on the page itself (a portal to <body>): inside the blurred card a fixed box would be placed and
  // clipped relative to the card. It closes on an outside tap, Esc or scrolling.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const gone = (e: Event) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', gone, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', gone, true);
    };
  }, [open]);

  const openMenu = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r)
      setPos({
        top: Math.min(r.bottom + 4, window.innerHeight - 320),
        left: Math.max(8, Math.min(r.left, window.innerWidth - 248))
      });
    setErr('');
    setOpen(!open);
  };
  const save = async (body: Record<string, unknown>, which: number | 'new') => {
    setBusy(which);
    setErr('');
    try {
      await api('/api/crm/customers/bulk', 'POST', {
        ids: [customerId],
        ...body
      });
      await qc.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setShown(null);
      setBusy(null);
    }
  };
  const toggleTag = (t: Tag) => {
    const on = has.has(t.id);
    const next = new Set(has);
    if (on) next.delete(t.id);
    else next.add(t.id);
    setShown(next);
    return save(on ? { removeTagIds: [t.id] } : { addTags: [t.name] }, t.id);
  };
  const filterBy = (id: number) => {
    const next = new Set(active);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFilter({ ...filter, tags: [...next] });
  };

  return (
    <div className="flex max-w-56 flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {mine.map((t) => (
        <button
          key={t.id}
          onClick={() => filterBy(t.id)}
          title={active.has(t.id) ? `Quitar el filtro «${t.name}»` : `Ver solo los clientes con «${t.name}»`}
          className={cn('rounded-full', active.has(t.id) && 'ring-2 ring-primary ring-offset-1 ring-offset-background')}
        >
          <Pill color={t.color || '#a1a1aa'}>#{t.name}</Pill>
        </button>
      ))}
      <button
        ref={btn}
        onClick={openMenu}
        aria-expanded={open}
        aria-label="Poner o quitar etiquetas"
        title="Poner o quitar etiquetas"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open &&
        createPortal(
          <div
            ref={box}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Etiquetas del cliente"
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-60 rounded-xl border border-border/60 bg-card p-2 text-sm shadow-xl"
          >
            <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Etiquetas de este cliente</p>
            <ul className="max-h-56 space-y-0.5 overflow-y-auto">
              {tags.map((t) => (
                <li key={t.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-accent/50">
                    <input type="checkbox" checked={has.has(t.id)} disabled={busy !== null} onChange={() => toggleTag(t)} className="size-4 accent-primary" />
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color || '#a1a1aa' }} />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {busy === t.id && <span className="text-xs text-muted-foreground">…</span>}
                  </label>
                </li>
              ))}
            </ul>
            <form
              className="mt-1 flex gap-1 border-t border-border/60 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) save({ addTags: [name.trim()] }, 'new').then(() => setName(''));
              }}
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nueva etiqueta"
                aria-label="Nueva etiqueta"
                maxLength={40}
                className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm outline-none focus:border-primary/60"
              />
              <button
                type="submit"
                disabled={!name.trim() || busy !== null}
                className="h-8 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                Crear
              </button>
            </form>
            {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
          </div>,
          document.body
        )}
    </div>
  );
}
