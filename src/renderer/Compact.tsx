// The always-visible card. No buttons: drag to move, click to expand.
// Only the background is translucent (alpha = idleOpacity); text stays opaque
// so the digits remain readable over any wallpaper or window.

import { useEffect, useRef } from 'react';
import { formatClock, formatMoney, modeLabel, phaseLabel } from '../shared/format';
import { display } from '../shared/timer';
import type { Snapshot } from '../shared/types';
import { api, stateLabel, toneOf, useDragClick, useNow } from './ui';

export function Compact({ snap, onExpand }: { snap: Snapshot; onExpand: () => void }) {
  const now = useNow();
  const card = useRef<HTMLDivElement>(null);
  const drag = useDragClick(onExpand);
  const task = snap.tasks.find((t) => t.status === 'active');

  // Report our height so the window is exactly the card: no transparent margin to block clicks.
  useEffect(() => {
    const el = card.current;
    if (!el) return;
    let last = 0;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h !== last) {
        last = h;
        api().reportHeight(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const style = { background: `rgba(20, 22, 27, ${snap.settings.idleOpacity})` };

  if (!task) {
    return (
      <div className="compact tone-neutral" ref={card} style={style} {...drag}>
        <div className="compact-empty">No task in focus - click to add one</div>
      </div>
    );
  }

  const d = display(task, now);
  const tone = toneOf(task, d);
  const mode = task.timer.mode;
  const digits = mode === 'stopwatch' ? formatClock(d.elapsed) : d.overtime > 0 ? `+${formatClock(d.overtime)}` : formatClock(d.remaining ?? 0);

  return (
    <div className={`compact tone-${tone}`} ref={card} style={style} {...drag} title="Click to open, drag to move">
      <div className="compact-meta">
        <span className="chip">{modeLabel(mode)}</span>
        <span className="state-dot" aria-hidden="true" />
        <span className="state-text">{stateLabel(d)}</span>
        {mode === 'pomodoro' && (
          <span className="phase-text">
            {d.phase === 'work' ? `Work ${d.cycle}/${task.timer.pomodoro.sessionsBeforeLongBreak}` : phaseLabel(d.phase)}
          </span>
        )}
      </div>
      <div className="compact-name">{task.name}</div>
      <div className="digits compact-digits">{digits}</div>
      {d.progress !== null && (
        <div className="bar" aria-hidden="true">
          <div className="bar-fill" style={{ width: `${d.progress * 100}%` }} />
        </div>
      )}
      {snap.settings.showMoneyInCompact && task.value > 0 && <div className="compact-money">{formatMoney(task.value, snap.settings.currency)}</div>}
    </div>
  );
}
