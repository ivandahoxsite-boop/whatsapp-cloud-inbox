'use client';

import { useEffect, useMemo, useState } from 'react';
import { Car, Pencil, Plus, Trash2, Zap } from 'lucide-react';
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
  /** Name of the car (group) this reply belongs to. */
  car: string;
};

type QuickRepliesData = {
  cars: string[];
  replies: QuickReply[];
};

const STORAGE_KEY = 'whatsapp-cloud-inbox-quick-replies';
const SELECTED_CAR_KEY = 'whatsapp-cloud-inbox-quick-replies-car';
const GENERAL = 'General';

const DEFAULT_DATA: QuickRepliesData = {
  cars: [GENERAL, 'Maverick R', 'RZR'],
  replies: [
    { id: 'saludo', car: GENERAL, label: 'Saludo', text: '¡Hola {nombre}! Gracias por escribirnos. ¿Para qué carro buscas?' },
    { id: 'horario', car: GENERAL, label: 'Horario', text: 'Atendemos de lunes a sábado de 9:00 a 19:00.' },
    { id: 'pagos', car: GENERAL, label: 'Pagos', text: 'Aceptamos efectivo, transferencia y tarjeta.' },
    { id: 'gracias', car: GENERAL, label: 'Gracias', text: '¡Gracias {nombre}! Cualquier duda, aquí estamos.' },
    { id: 'maverick-info', car: 'Maverick R', label: 'Info', text: 'Para tu Maverick R tenemos: ' },
    { id: 'maverick-precio', car: 'Maverick R', label: 'Precio', text: 'El precio para Maverick R es: $' },
    { id: 'rzr-info', car: 'RZR', label: 'Info', text: 'Para tu RZR tenemos: ' },
    { id: 'rzr-precio', car: 'RZR', label: 'Precio', text: 'El precio para RZR es: $' },
  ],
};

function isReply(item: unknown): item is { id: string; label: string; text: string; car?: unknown } {
  const value = item as Record<string, unknown> | null;
  return Boolean(
    value &&
      typeof value.id === 'string' &&
      typeof value.label === 'string' &&
      typeof value.text === 'string'
  );
}

function normalizeData(parsed: unknown): QuickRepliesData {
  // Older versions stored a plain array of replies without cars.
  const rawReplies = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as QuickRepliesData | null)?.replies)
      ? (parsed as QuickRepliesData).replies
      : null;
  if (!rawReplies) return DEFAULT_DATA;

  const replies: QuickReply[] = rawReplies.filter(isReply).map(reply => ({
    id: reply.id,
    label: reply.label,
    text: reply.text,
    car: typeof reply.car === 'string' && reply.car.trim() ? reply.car : GENERAL,
  }));

  const storedCars = Array.isArray((parsed as QuickRepliesData | null)?.cars)
    ? (parsed as QuickRepliesData).cars.filter((car): car is string => typeof car === 'string' && Boolean(car.trim()))
    : [];
  const cars = Array.from(new Set([...storedCars, ...replies.map(reply => reply.car)]));

  return { cars: cars.length > 0 ? cars : [GENERAL], replies };
}

function loadData(): QuickRepliesData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeData(JSON.parse(raw)) : DEFAULT_DATA;
  } catch {
    return DEFAULT_DATA;
  }
}

function saveData(data: QuickRepliesData) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode, blocked site data): keep in memory only.
  }
}

function loadSelectedCar(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_CAR_KEY);
  } catch {
    return null;
  }
}

function saveSelectedCar(car: string) {
  try {
    window.localStorage.setItem(SELECTED_CAR_KEY, car);
  } catch {
    // Ignore: remembering the selected car is only a convenience.
  }
}

/** Replaces {nombre} / {name} with the contact's name (or removes it when unknown). */
export function fillQuickReplyText(text: string, contactName?: string): string {
  const name = contactName?.trim() ?? '';
  return text
    .replace(/\s*\{(nombre|name)\}/gi, name ? ` ${name}` : '')
    .replace(/^\s+/, '');
}

const chipBase =
  'h-8 flex-shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-50';
const addChip =
  'flex h-8 flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-[var(--chat-border-strong)] px-3 text-xs text-muted-foreground hover:border-primary hover:text-primary';
const rowScroll = 'flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]';

type Props = {
  contactName?: string;
  disabled?: boolean;
  onSelect: (text: string) => void;
};

export function QuickRepliesBar({ contactName, disabled, onSelect }: Props) {
  const [data, setData] = useState<QuickRepliesData>({ cars: [], replies: [] });
  const [selectedCar, setSelectedCar] = useState(GENERAL);
  const [editMode, setEditMode] = useState(false);

  // Reply editor
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [replyLabel, setReplyLabel] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyCar, setReplyCar] = useState(GENERAL);

  // Car editor
  const [carDialogOpen, setCarDialogOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<string | null>(null);
  const [carName, setCarName] = useState('');

  useEffect(() => {
    const loaded = loadData();
    setData(loaded);
    const storedCar = loadSelectedCar();
    setSelectedCar(storedCar && loaded.cars.includes(storedCar) ? storedCar : loaded.cars[0]);
  }, []);

  const visibleReplies = useMemo(
    () => data.replies.filter(reply => reply.car === selectedCar),
    [data.replies, selectedCar]
  );

  const updateData = (next: QuickRepliesData) => {
    setData(next);
    saveData(next);
  };

  const selectCar = (car: string) => {
    setSelectedCar(car);
    saveSelectedCar(car);
  };

  // ----- Cars -----
  const openCarEditor = (car?: string) => {
    setEditingCar(car ?? null);
    setCarName(car ?? '');
    setCarDialogOpen(true);
  };

  const trimmedCarName = carName.trim();
  const carNameTaken =
    Boolean(trimmedCarName) &&
    trimmedCarName !== editingCar &&
    data.cars.some(car => car.toLowerCase() === trimmedCarName.toLowerCase());

  const handleSaveCar = () => {
    if (!trimmedCarName || carNameTaken) return;

    if (editingCar) {
      updateData({
        cars: data.cars.map(car => (car === editingCar ? trimmedCarName : car)),
        replies: data.replies.map(reply =>
          reply.car === editingCar ? { ...reply, car: trimmedCarName } : reply
        ),
      });
    } else {
      updateData({ ...data, cars: [...data.cars, trimmedCarName] });
    }
    selectCar(trimmedCarName);
    setCarDialogOpen(false);
  };

  const handleDeleteCar = () => {
    if (!editingCar) return;
    const cars = data.cars.filter(car => car !== editingCar);
    const nextCars = cars.length > 0 ? cars : [GENERAL];
    updateData({
      cars: nextCars,
      replies: data.replies.filter(reply => reply.car !== editingCar),
    });
    selectCar(nextCars[0]);
    setCarDialogOpen(false);
  };

  const handleCarClick = (car: string) => {
    if (editMode) {
      openCarEditor(car);
      return;
    }
    selectCar(car);
  };

  // ----- Replies -----
  const openReplyEditor = (reply?: QuickReply) => {
    setEditingReplyId(reply?.id ?? null);
    setReplyLabel(reply?.label ?? '');
    setReplyText(reply?.text ?? '');
    setReplyCar(reply?.car ?? selectedCar);
    setReplyDialogOpen(true);
  };

  const handleSaveReply = () => {
    const label = replyLabel.trim();
    const text = replyText.trim();
    if (!label || !text) return;

    if (editingReplyId) {
      updateData({
        ...data,
        replies: data.replies.map(reply =>
          reply.id === editingReplyId ? { ...reply, label, text, car: replyCar } : reply
        ),
      });
    } else {
      updateData({
        ...data,
        replies: [
          ...data.replies,
          { id: `qr_${Date.now().toString(36)}`, label, text, car: replyCar },
        ],
      });
    }
    selectCar(replyCar);
    setReplyDialogOpen(false);
  };

  const handleDeleteReply = () => {
    if (!editingReplyId) return;
    updateData({ ...data, replies: data.replies.filter(reply => reply.id !== editingReplyId) });
    setReplyDialogOpen(false);
  };

  const handleReplyClick = (reply: QuickReply) => {
    if (editMode) {
      openReplyEditor(reply);
      return;
    }
    onSelect(fillQuickReplyText(reply.text, contactName));
  };

  return (
    <>
      <div className="mx-auto w-full max-w-[900px] space-y-1.5 px-2.5 pt-2 sm:px-3">
        {/* Row 1: cars */}
        <div className="flex items-center gap-1.5">
          <Car className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
          <div className={rowScroll} role="tablist" aria-label="Cars">
            {data.cars.map(car => {
              const active = car === selectedCar;
              return (
                <button
                  key={car}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleCarClick(car)}
                  className={cn(
                    chipBase,
                    editMode
                      ? 'border-dashed border-primary text-primary hover:bg-[var(--chat-hover)]'
                      : active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-[var(--chat-border-strong)] bg-[var(--chat-surface)] text-foreground hover:border-primary hover:text-primary'
                  )}
                >
                  {editMode && <Pencil className="mr-1 inline h-3 w-3" aria-hidden="true" />}
                  {car}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => openCarEditor()}
              className={addChip}
              aria-label="Add car"
              title="Add car"
            >
              <Plus className="h-3.5 w-3.5" />
              Carro
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
            title={editMode ? 'Done editing' : 'Edit cars and replies'}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Row 2: replies of the selected car */}
        <div className="flex items-center gap-1.5">
          <Zap className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
          <div className={rowScroll} role="toolbar" aria-label={`Quick replies for ${selectedCar}`}>
            {visibleReplies.map(reply => (
              <button
                key={reply.id}
                type="button"
                onClick={() => handleReplyClick(reply)}
                disabled={disabled}
                title={reply.text}
                className={cn(
                  chipBase,
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
              onClick={() => openReplyEditor()}
              className={addChip}
              aria-label="Add quick reply"
              title="Add quick reply"
            >
              <Plus className="h-3.5 w-3.5" />
              {visibleReplies.length === 0 ? `Respuesta para ${selectedCar}` : 'Respuesta'}
            </button>
          </div>
        </div>
      </div>

      {/* Reply editor */}
      <Dialog open={replyDialogOpen} onOpenChange={setReplyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingReplyId ? 'Editar respuesta' : 'Nueva respuesta'}</DialogTitle>
            <DialogDescription>
              Escribe {'{nombre}'} para poner el nombre del cliente automáticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="quick-reply-car">Carro</Label>
              <select
                id="quick-reply-car"
                value={replyCar}
                onChange={e => setReplyCar(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {data.cars.map(car => (
                  <option key={car} value={car} className="bg-background text-foreground">
                    {car}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-reply-label">Nombre del botón</Label>
              <Input
                id="quick-reply-label"
                value={replyLabel}
                onChange={e => setReplyLabel(e.target.value)}
                placeholder="Precio"
                maxLength={30}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="quick-reply-text">Mensaje</Label>
              <Textarea
                id="quick-reply-text"
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder="¡Hola {nombre}! El precio para tu carro es..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editingReplyId ? (
              <Button type="button" variant="ghost" onClick={handleDeleteReply} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Borrar
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" onClick={handleSaveReply} disabled={!replyLabel.trim() || !replyText.trim()}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Car editor */}
      <Dialog open={carDialogOpen} onOpenChange={setCarDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingCar ? 'Editar carro' : 'Nuevo carro'}</DialogTitle>
            <DialogDescription>
              {editingCar
                ? 'Si borras el carro, también se borran sus respuestas.'
                : 'Después agrega las respuestas de este carro con el botón "+ Respuesta".'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="quick-reply-car-name">Nombre del carro</Label>
            <Input
              id="quick-reply-car-name"
              value={carName}
              onChange={e => setCarName(e.target.value)}
              placeholder="Maverick X3"
              maxLength={30}
            />
            {carNameTaken && <p className="text-xs text-destructive">Ya existe un carro con ese nombre.</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editingCar ? (
              <Button type="button" variant="ghost" onClick={handleDeleteCar} className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Borrar carro
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" onClick={handleSaveCar} disabled={!trimmedCarName || carNameTaken}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
