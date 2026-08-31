import { useCallback, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Page, Button, GridConfig } from '@shared/protocol';

interface DeckGridProps {
  page: Page;
  onTrigger: (buttonId: string) => void;
  onEditButton: (buttonId: string) => void;
  onAddButton: () => void;
  onReorder: (buttons: Button[]) => void;
  editMode: boolean;
  isLandscape: boolean;
  triggerResults?: Map<string, { ok: boolean; time: number }>;
  previewGrid?: GridConfig | null;
}

export function DeckGrid({ page, onTrigger, onEditButton, onAddButton, onReorder, editMode, isLandscape, triggerResults, previewGrid }: DeckGridProps) {
  const grid = previewGrid || page.grid;
  const baseCols = grid.cols;
  const baseRows = grid.rows;
  const cols = isLandscape ? baseRows : baseCols;
  const rows = isLandscape ? baseCols : baseRows;

  const allSlots: { key: string; row: number; col: number; button: Button | null }[] = [];
  const buttonMap = new Map<string, Button>();
  page.buttons.forEach((btn) => {
    const key = isLandscape
      ? `${btn.position.col}-${btn.position.row}`
      : `${btn.position.row}-${btn.position.col}`;
    buttonMap.set(key, btn);
  });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${r}-${c}`;
      allSlots.push({ key, row: r, col: c, button: buttonMap.get(key) || null });
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromSlot = allSlots.find((s) => s.key === active.id);
    const toSlot = allSlots.find((s) => s.key === over.id);
    if (!fromSlot || !toSlot) return;

    const fromBtn = fromSlot.button;
    const toBtn = toSlot.button;

    if (!fromBtn && !toBtn) return;

    const toR = Math.floor(allSlots.indexOf(toSlot) / cols);
    const toC = allSlots.indexOf(toSlot) % cols;
    const fromR = Math.floor(allSlots.indexOf(fromSlot) / cols);
    const fromC = allSlots.indexOf(fromSlot) % cols;

    const toPos = isLandscape ? { row: toC, col: toR } : { row: toR, col: toC };
    const fromPos = isLandscape ? { row: fromC, col: fromR } : { row: fromR, col: fromC };

    const newButtons: Button[] = page.buttons.map((btn) => {
      if (fromBtn && btn.id === fromBtn.id) {
        return { ...btn, position: toPos };
      }
      if (toBtn && btn.id === toBtn.id) {
        return { ...btn, position: fromPos };
      }
      return btn;
    });

    onReorder(newButtons);
  }, [allSlots, cols, isLandscape, page.buttons, onReorder]);

  const itemIds = allSlots.map((s) => s.key);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={rectSortingStrategy}>
        <div className="deck-grid" style={{ '--cols': cols, '--rows': rows } as React.CSSProperties}>
          {allSlots.map((slot) => (
            <SortableCell
              key={slot.key}
              slot={slot}
              editMode={editMode}
              onTrigger={onTrigger}
              onEdit={onEditButton}
              onAdd={onAddButton}
              triggerResult={slot.button ? triggerResults?.get(slot.button.id) : undefined}
              textColor={page.textColor}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

interface SlotData {
  key: string;
  row: number;
  col: number;
  button: Button | null;
}

interface SortableCellProps {
  slot: SlotData;
  editMode: boolean;
  onTrigger: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
  triggerResult?: { ok: boolean; time: number };
  textColor?: string;
}

function SortableCell({ slot, editMode, onTrigger, onEdit, onAdd, triggerResult, textColor }: SortableCellProps) {
  const longPressTimer = useRef<ReturnType<typeof setTimeout>>();
  const pressing = useRef(false);
  const [triggered, setTriggered] = useState(false);
  // Legacy configs can hold icon URLs pointing at the desktop's LAN address, which
  // never load from elsewhere. Fall back to the label rather than showing a blank.
  const [iconBroken, setIconBroken] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slot.key, disabled: !editMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.9 : 1,
    background: slot.button?.backgroundColor || undefined,
    borderColor: slot.button?.backgroundColor ? `${slot.button.backgroundColor}80` : undefined,
  };

  const handlePointerDown = useCallback(() => {
    if (!slot.button || editMode) return;
    pressing.current = true;
    longPressTimer.current = setTimeout(() => {
      onEdit(slot.button!.id);
      pressing.current = false;
    }, 600);
  }, [slot.button, editMode, onEdit]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (pressing.current && slot.button) {
      setTriggered(true);
      onTrigger(slot.button.id);
      setTimeout(() => setTriggered(false), 400);
    }
    pressing.current = false;
  }, [slot.button, onTrigger]);

  const handlePointerLeave = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    pressing.current = false;
  }, []);

  if (!slot.button) {
    return (
      <button
        ref={setNodeRef}
        style={style}
        onClick={onAdd}
        className="deck-cell opacity-40 hover:opacity-60 transition-opacity"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    );
  }

  const icon = slot.button.icon;
  const isEmoji = icon && icon.length <= 4 && !icon.startsWith('http');
  const isFullSize = slot.button.iconSize === 'full';
  const showIcon = !!icon && (isEmoji || !iconBroken);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`deck-cell relative ${isDragging ? 'ring-2 ring-white/60 scale-105' : ''} ${triggered ? 'deck-cell-triggered' : ''}`}
      onPointerDown={editMode ? undefined : handlePointerDown}
      onPointerUp={editMode ? undefined : handlePointerUp}
      onPointerLeave={editMode ? undefined : handlePointerLeave}
      onClick={editMode ? (e) => { e.stopPropagation(); onEdit(slot.button!.id); } : undefined}
    >
      {showIcon ? (
        isEmoji ? (
          <span className={`${isFullSize ? 'cell-icon-full' : 'cell-icon'} leading-none pointer-events-none select-none`}>{icon}</span>
        ) : (
          <img
            src={icon}
            alt={slot.button.label}
            className={`${isFullSize ? 'cell-img-full' : 'cell-img'} drop-shadow-lg pointer-events-none`}
            draggable={false}
            onError={() => setIconBroken(true)}
          />
        )
      ) : (
        <div className={`${isFullSize ? 'cell-img-full bg-white/10 flex items-center justify-center rounded-[var(--btn-radius)]' : 'cell-img rounded-xl bg-white/10 flex items-center justify-center'}`}>
          <span 
            className={`${isFullSize ? 'text-2xl' : 'text-sm'} font-bold pointer-events-none`}
            style={textColor ? { color: textColor } : { color: 'rgba(255,255,255,0.6)' }}
          >
            {slot.button.label.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      {!isFullSize && (
        <span 
          className="cell-label pointer-events-none"
          style={textColor ? { color: textColor } : undefined}
        >
          {slot.button.label}
        </span>
      )}

      {triggerResult && !editMode && (
        <div
          className={`absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full pointer-events-none ${
            triggerResult.ok ? 'bg-green-400' : 'bg-red-400'
          }`}
          style={{
            boxShadow: triggerResult.ok ? '0 0 6px rgba(74,222,128,0.6)' : '0 0 6px rgba(248,113,113,0.6)',
          }}
        />
      )}

      {editMode && (
        <div
          {...attributes}
          {...listeners}
          className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-[var(--btn-radius)] cursor-grab active:cursor-grabbing touch-none"
          style={{ zIndex: 10 }}
        >
          <div className="flex flex-col items-center gap-0.5">
            <svg className="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
            <span className="text-[8px] text-white/40 font-medium">Drag</span>
          </div>
        </div>
      )}
    </div>
  );
}
