'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type QuickReply = {
  id: string;
  label: string;
  text: string;
};

const STORAGE_KEY = 'whatsapp-cloud-inbox-quick-replies';

const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: 'saludo', label: 'Saludo', text: '¡Hola {nombre}! Gracias por escribirnos. ¿En qué te puedo ayudar?' },
  { id: 'horario', label: 'Horario', text: 'Atendemos de lunes a sábado de 9:00 a 19:00.' },
  { id: 'precios', label: 'Precios', text: 'Con gusto te comparto nuestros precios: ' },
  { id: 'pagos', label: 'Pagos', text: 'Aceptamos efectivo, transferencia y tarjeta.' },
  { id: 'gracias', label: 'Gracias', text: '¡Gracias {nombre}! Cualquier duda, aquí estamos.' },
];

function loadQuickReplies(): QuickReply[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_QUICK_REPLIES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_QUICK_REPLIES;
    return parsed.filter(
      (item): item is QuickReply =>
        item &&
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        typeof item.text === 'string'
    );
  } catch {
    return DEFAULT_QUICK_REPLIES;
  }
}

function saveQuickReplies(replies: QuickReply[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(replies));
  } catch {
    // Storage unavailable (private mode, blocked site data): keep in memory only.
  }
}

/** Replaces {nombre} / {name} with the contact's name (or removes it when unknown). */
export function fillQuickReplyText(text: string, contactName?: string): string {
  const name = contactName?.trim() ?? '';
  return text
    .replace(/\s*\{(nombre|name)\}/gi, name ? ` ${name}` : '')
    .replace(/^\s+/, '');
}

type Props = {
  contactName?: string;
  disabled?: boolean;
  onSelect: (text: string) => void;
};

export function QuickRepliesBar({ contactName, disabled, onSelect }: Props) {
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    setReplies(loadQuickReplies());
  }, []);

  const updateReplies = (next: QuickReply[]) => {
    setReplies(next);
    saveQuickReplies(next);
  };

  const openEditor = (reply?: QuickReply) => {
    setEditingId(reply?.id ?? null);
    setLabel(reply?.label ?? '');
    setText(reply?.text ?? '');
    setDialogOpen(true);
  };

  const handleSave = () => {
    const trimmedLabel = label.trim();
    const trimmedText = text.trim();
    if (!trimmedLabel || !trimmedText) return;

    if (editingId) {
      updateReplies(
        replies.map(reply =>
          reply.id === editingId ? { ...reply, label: trimmedLabel, text: trimmedText } : reply
        )
      );
    } else {
      updateReplies([
        ...replies,
        { id: `qr_${Date.now().toString(36)}`, label: trimmedLabel, text: trimmedText },
      ]);
    }
    setDialogOpen(false);
  };

  const handleDelete = () => {
    if (!editingId) return;
    updateReplies(replies.filter(reply => reply.id !== editingId));
    setDialogOpen(false);
  };

  const handleChipClick = (reply: QuickReply) => {
    if (editMode) {
      openEditor(reply);
      return;
    }
    onSelect(fillQuickReplyText(reply.text, contactName));
  };

  return (
    <>
      <div className="mx-auto flex w-full max-w-[900px] items-center gap-1.5 px-2.5 pt-2 sm:px-3">
        <Zap className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
        <div
          className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]"
          role="toolbar"
          aria-label="Quick replies"
        >
          {replies.map(reply => (
            <button
              key={reply.id}
              type="button"
              onClick={() => handleChipClick(reply)}
              disabled={disabled}
              title={reply.text}
              className={cn(
                'h-8 flex-shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50',
                editMode
                  ? 'border-dashed border-primary text-primary hover:bg-[var(--chat-hover)]'
                  : 'border-[var(--chat-border-strong)] bg-[var(--chat-surface)] text-foreground hover:border-primary hover:text-primary'
              )}
            >
              {editMode && <Pencil className="mr-1 inline h-3 w-3" aria-hidden="true" />}
              {reply.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => openEditor()}
            className="flex h-8 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-[var(--chat-border-strong)] px-3 text-xs text-muted-foreground hover:border-primary hover:text-primary"
            aria-label="Add quick reply"
            title="Add quick reply"
          >
            <Plus className="h-3.5 w-3.5" />
            {replies.length === 0 && 'Add quick reply'}
          </button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setEditMode(value => !value)}
          className={cn(
            'size-8 flex-shrink-0 text-muted-foreground',
            editMode && 'bg-[var(--chat-hover)] text-primary'
          )}
          aria-pressed={editMode}
          aria-label={editMode ? 'Done editing quick replies' : 'Edit quick replies'}
          title={editMode ? 'Done editing' : 'Edit quick replies'}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit quick reply' : 'New quick reply'}</DialogTitle>
            <DialogDescription>
              Write {'{nombre}'} to insert the contact&apos;s name automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-reply-label">Button name</Label>
              <Input
                id="quick-reply-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="Saludo"
                maxLength={30}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-reply-text">Message</Label>
              <Textarea
                id="quick-reply-text"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="¡Hola {nombre}! ¿En qué te puedo ayudar?"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editingId ? (
              <Button type="button" variant="ghost" onClick={handleDelete} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" onClick={handleSave} disabled={!label.trim() || !text.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
