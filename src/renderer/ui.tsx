// Small shared UI pieces: the API handle, a clock hook, modal, form field,
// drag-or-click handling, theme variables, inline SVG icons and the beep.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { MonolithApi } from '../shared/api';
import type { TimerDisplay } from '../shared/timer';
import type { Priority, Settings, Task } from '../shared/types';

declare global {
  interface Window {
    monolith: MonolithApi;
  }
}
export const api = (): MonolithApi => window.monolith;

/** Re-render on a short interval. Time itself comes from Date.now(), never from counting ticks. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export type Tone = 'running' | 'paused' | 'expired' | 'break' | 'neutral';

export function toneOf(task: Task, d: TimerDisplay): Tone {
  if (d.expired) return 'expired';
  if (d.status === 'running') return task.timer.mode === 'pomodoro' && d.phase !== 'work' ? 'break' : 'running';
  if (d.status === 'paused') return 'paused';
  return 'neutral';
}

/** Theme + accent as attributes for a wrapper element; CSS variables do the rest. */
export function themeProps(s: Settings): { 'data-theme': string; style: CSSProperties } {
  return { 'data-theme': s.theme, style: (s.accent ? { '--accent': s.accent } : {}) as CSSProperties };
}

/** Compact card typography and background as CSS variables. */
export function cardVars(s: Settings): CSSProperties {
  const a = s.appearance;
  return {
    '--status-px': `${a.statusPx}px`,
    '--title-px': `${a.titlePx}px`,
    '--digits-px': `${a.digitsPx}px`,
    '--bar-px': `${a.barPx}px`,
    '--card-alpha': String(s.idleOpacity),
  } as CSSProperties;
}

export function PriorityDot({ priority }: { priority: Priority }) {
  if (priority === 'none') return null;
  return <span className={`prio prio-${priority}`} title={`${priority[0].toUpperCase()}${priority.slice(1)} priority`} aria-label={`${priority} priority`} />;
}

export function stateLabel(d: TimerDisplay): string {
  if (d.expired) return "Time's up";
  if (d.status === 'running') return 'Running';
  if (d.status === 'paused') return 'Paused';
  return 'Ready';
}

/**
 * Pointer handling for a draggable surface. Main moves the window while the
 * button is held; if the pointer barely moved, the release counts as a click.
 */
export function useDragClick(onClick?: () => void) {
  const dragging = useRef(false);
  return {
    onPointerDown(e: React.PointerEvent<HTMLElement>) {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, select, textarea, a')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragging.current = true;
      api().dragStart();
    },
    async onPointerUp() {
      if (!dragging.current) return;
      dragging.current = false;
      const moved = await api().dragEnd();
      if (!moved) onClick?.();
    },
    onLostPointerCapture() {
      if (!dragging.current) return;
      dragging.current = false;
      void api().dragEnd();
    },
  };
}

export function Modal(props: { title: string; children: ReactNode; onClose?: () => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, button');
    first?.focus();
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && props.onClose) {
            e.stopPropagation();
            props.onClose();
          }
        }}
      >
        <h2>{props.title}</h2>
        {props.children}
      </div>
    </div>
  );
}

export function Field(props: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className={`field${props.error ? ' has-error' : ''}`}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && !props.error && <span className="field-hint">{props.hint}</span>}
      {props.error && <span className="field-error">{props.error}</span>}
    </label>
  );
}

const svg = (d: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const Icon = {
  play: svg(<path d="M5 3.5v9l7-4.5z" fill="currentColor" />),
  pause: svg(<path d="M5.5 3.5v9M10.5 3.5v9" />),
  reset: svg(<path d="M3.5 8a4.5 4.5 0 1 0 1.4-3.3M3.5 2.5v2.5H6" />),
  skip: svg(<path d="M4 3.5v9l6-4.5zM12 3.5v9" />),
  up: svg(<path d="M4 10l4-4 4 4" />),
  down: svg(<path d="M4 6l4 4 4-4" />),
  edit: svg(<path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" />),
  trash: svg(<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" />),
  close: svg(<path d="M4 4l8 8M12 4l-8 8" />),
  grip: svg(<path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" strokeWidth="2.4" />),
  check: svg(<path d="M3.5 8.5l3 3 6-7" />),
};

let audio: AudioContext | null = null;
/** Two short soft beeps, synthesised so there is no audio asset to ship. */
export function beep(): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    for (const offset of [0, 0.22]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.18);
    }
  } catch {
    // Audio is a nicety; never let it break the UI.
  }
}
