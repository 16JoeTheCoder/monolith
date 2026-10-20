// Root component: holds the latest snapshot from main and decides which view
// is visible. Order matters to avoid a flash of the wrong size:
//   expand:   main resizes first, then the snapshot (expanded=true) swaps the view;
//   collapse: we swap to the compact view first, then ask main to shrink.
// An error boundary wraps everything so a rendering bug shows a restart
// button instead of an invisible window.

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Snapshot } from '../shared/types';
import { Compact } from './Compact';
import { Panel } from './Panel';
import { api, beep, themeProps } from './ui';

export function App() {
  return (
    <ErrorBoundary>
      <MonolithApp />
    </ErrorBoundary>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        {/* Short on purpose: the compact window may be only 80 px tall. Data is already saved. */}
        <strong>Monolith hit an error.</strong>
        <button className="btn primary" onClick={() => api().restart(`${error.name}: ${error.message}\n${error.stack ?? ''}`)}>
          Restart Monolith
        </button>
      </div>
    );
  }
}

function MonolithApp() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [view, setView] = useState<'compact' | 'panel'>('compact');
  const [closeRequest, setCloseRequest] = useState(0);
  const collapsing = useRef(false);
  const lastExpanded = useRef(false);

  useEffect(() => {
    const apply = (s: Snapshot) => {
      // Edge-triggered so a routine snapshot never fights a collapse in progress.
      if (s.expanded && !lastExpanded.current && !collapsing.current) setView('panel');
      if (!s.expanded && lastExpanded.current) setCloseRequest((n) => n + 1);
      if (!s.expanded) collapsing.current = false;
      lastExpanded.current = s.expanded;
      setSnap(s);
    };
    void api().getSnapshot().then(apply);
    const offSnap = api().onSnapshot(apply);
    const offBeep = api().onBeep(beep);
    return () => {
      offSnap();
      offBeep();
    };
  }, []);

  const collapse = useCallback(() => {
    collapsing.current = true;
    setView('compact');
    requestAnimationFrame(() => void api().collapse());
  }, []);

  if (!snap) return null;
  return view === 'panel' ? (
    <div className="theme-root" {...themeProps(snap.data.settings)}>
      <Panel snap={snap} onCollapse={collapse} closeRequest={closeRequest} />
    </div>
  ) : (
    <Compact snap={snap} onExpand={() => void api().expand()} />
  );
}
