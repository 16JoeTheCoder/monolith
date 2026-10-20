// The always-visible card. No buttons: drag to move, click to expand.
// Only the background is translucent (alpha = idleOpacity, down to 0%); text
// keeps a text-shadow so it stays readable over any wallpaper or window.
// CompactCard is also rendered as the live preview in Settings > Appearance.

import { useEffect, useRef, type Ref } from 'react';
import { formatClock, modeLabel, phaseLabel } from '../shared/format';
import { display } from '../shared/timer';
import type { Settings, Snapshot, Task } from '../shared/types';
import { PriorityDot, api, cardVars, stateLabel, themeProps, toneOf, useDragClick, useNow } from './ui';

interface CardProps {
  task: Task | null;
  settings: Settings;
  now: number;
  cardRef?: Ref<HTMLDivElement>;
  handlers?: ReturnType<typeof useDragClick>;
  className?: string;
}

export function CompactCard({ task, settings, now, cardRef, handlers, className = '' }: CardProps) {
  const theme = themeProps(settings);
  const style = { ...cardVars(settings), ...theme.style };
  if (!task) {
    return (
      <div className={`compact tone-neutral ${className}`} data-theme={theme['data-theme']} ref={cardRef} style={style} {...handlers}>
        <div className="compact-empty">No task in focus - click to add one</div>
      </div>
    );
  }
  const d = display(task, now);
  const mode = task.timer.mode;
  const digits = mode === 'stopwatch' ? formatClock(d.elapsed) : d.overtime > 0 ? `+${formatClock(d.overtime)}` : formatClock(d.remaining ?? 0);
  return (
    <div
      className={`compact tone-${toneOf(task, d)} ${className}`}
      data-theme={theme['data-theme']}
      ref={cardRef}
      style={style}
      {...handlers}
      title="Click to open, drag to move"
    >
      <div className="compact-meta">
        <span className="chip">{modeLabel(mode)}</span>
        <span className="state-text">{stateLabel(d)}</span>
        {mode === 'pomodoro' && (
          <span className="phase-text">
            {d.phase === 'work' ? `Work ${d.cycle}/${task.timer.pomodoro.sessionsBeforeLongBreak}` : phaseLabel(d.phase)}
          </span>
        )}
      </div>
      <div className="compact-name">
        <PriorityDot priority={task.priority} />
        {task.name}
      </div>
      <div className="digits compact-digits">{digits}</div>
      {d.progress !== null && (
        <div className="bar" aria-hidden="true">
          <div className={`bar-fill${d.progress >= 0.9 && d.progress < 1 ? ' late' : ''}`} style={{ width: `${d.progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}

export function Compact({ snap, onExpand }: { snap: Snapshot; onExpand: () => void }) {
  const now = useNow();
  const card = useRef<HTMLDivElement>(null);
  const drag = useDragClick(onExpand);
  const task = snap.data.tasks.find((t) => t.status === 'active') ?? null;

  // Report our size so the window is exactly the card: no transparent margin to block clicks.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    let last = '';
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const w = Math.ceil(r.width);
      const h = Math.ceil(r.height);
      if (`${w}x${h}` !== last) {
        last = `${w}x${h}`;
        api().reportSize(w, h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <CompactCard task={task} settings={snap.data.settings} now={now} cardRef={card} handlers={drag} />;
}
