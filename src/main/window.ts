// The single overlay window: frameless, transparent, always on top, sized
// exactly to the card so it never blocks clicks on other apps.
//
// Two non-obvious things live here:
// 1. Focus handoff. The compact card is non-focusable so it never steals typing.
//    Expanding makes it focusable (and focuses it when the user asked); collapsing
//    makes it non-focusable and hide()+showInactive() so Windows hands focus
//    back to the previously active app.
// 2. Dragging. We do not use -webkit-app-region (it swallows clicks). Main polls
//    the cursor every ~8 ms and calls setBounds with the width/height captured at
//    drag start. Passing the same size each time avoids the slow growth/shrink
//    that setPosition causes at non-100% DPI due to DIP<->pixel rounding.

import { BrowserWindow, screen, type Rectangle } from 'electron';

export const EXPANDED_WIDTH = 420;
const MARGIN = 16;
// Compact window fits the card; these bounds stop runaway sizes from huge fonts.
const MIN_W = 240;
const MAX_W = 520;
const MIN_H = 80;
const MAX_H = 260;
const DRAG_THRESHOLD = 4;

type Pos = { x: number; y: number };

export class OverlayWindow {
  readonly win: BrowserWindow;
  expanded = false;
  private compactWidth = 300;
  private compactHeight = 96;
  private anchor: Pos;
  private drag: { timer: NodeJS.Timeout; cursor: Pos; bounds: Rectangle; moved: boolean } | null = null;

  constructor(preload: string, saved: Pos | null, private onMoved: (pos: Pos) => void) {
    this.anchor = this.clampAnchor(saved ?? defaultAnchor(), this.compactWidth, this.compactHeight);
    this.win = new BrowserWindow({
      ...this.anchor,
      width: this.compactWidth,
      height: this.compactHeight,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      title: 'Monolith',
      webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    });
    // 'screen-saver' level keeps the card above full-screen-ish windows and the taskbar.
    this.win.setAlwaysOnTop(true, 'screen-saver');
    this.win.once('ready-to-show', () => this.win.showInactive());
  }

  /** Main resizes first; the renderer swaps to the panel once the snapshot says expanded. */
  expand(focus: boolean): void {
    if (this.win.isDestroyed()) return;
    if (!this.expanded) {
      this.expanded = true;
      this.win.setFocusable(true);
      this.win.setBounds(this.expandedBounds());
    }
    if (focus) {
      this.win.show();
      this.win.focus();
    }
  }

  /** The renderer has already swapped to the compact view; now shrink and give focus back. */
  collapse(): void {
    if (this.win.isDestroyed() || !this.expanded) return;
    this.expanded = false;
    this.win.setFocusable(false);
    this.win.setBounds({ ...this.anchor, width: this.compactWidth, height: this.compactHeight });
    this.win.hide();
    this.win.showInactive();
    this.win.setAlwaysOnTop(true, 'screen-saver');
  }

  /** Fit the compact window to the card, keeping the top-left corner where it is. */
  setCompactSize(w: number, h: number): void {
    const width = Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
    const height = Math.round(Math.min(MAX_H, Math.max(MIN_H, h)));
    if (width === this.compactWidth && height === this.compactHeight) return;
    this.compactWidth = width;
    this.compactHeight = height;
    if (!this.expanded && !this.drag) this.win.setBounds({ ...this.anchor, width, height });
  }

  dragStart(): void {
    if (this.drag || this.win.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = this.win.getBounds();
    const timer = setInterval(() => this.dragMove(), 8);
    this.drag = { timer, cursor, bounds, moved: false };
  }

  dragEnd(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.dragMove();
    clearInterval(d.timer);
    this.drag = null;
    if (d.moved) {
      const b = this.win.getBounds();
      this.anchor = { x: b.x, y: b.y };
      this.onMoved(this.anchor);
    }
    return d.moved;
  }

  private dragMove(): void {
    const d = this.drag;
    if (!d || this.win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const dx = p.x - d.cursor.x;
    const dy = p.y - d.cursor.y;
    if (!d.moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    d.moved = true;
    this.win.setBounds({ x: d.bounds.x + dx, y: d.bounds.y + dy, width: d.bounds.width, height: d.bounds.height });
  }

  /** Same top-left anchor; shifted up only if the panel would overflow the bottom. */
  private expandedBounds(): Rectangle {
    const wa = screen.getDisplayMatching({ ...this.anchor, width: this.compactWidth, height: this.compactHeight }).workArea;
    const height = Math.min(700, wa.height - 2 * MARGIN);
    const x = Math.min(Math.max(this.anchor.x, wa.x), wa.x + wa.width - EXPANDED_WIDTH);
    const y = Math.max(wa.y, Math.min(this.anchor.y, wa.y + wa.height - height));
    return { x, y, width: EXPANDED_WIDTH, height };
  }

  /** Keep a remembered position inside the nearest display's work area. */
  private clampAnchor(pos: Pos, width: number, height: number): Pos {
    const wa = screen.getDisplayNearestPoint(pos).workArea;
    return {
      x: Math.min(Math.max(pos.x, wa.x), wa.x + wa.width - width),
      y: Math.min(Math.max(pos.y, wa.y), wa.y + wa.height - height),
    };
  }
}

/** Top-left of the primary work area (the right side is reserved for the user's own stats). */
function defaultAnchor(): Pos {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + MARGIN, y: wa.y + MARGIN };
}
