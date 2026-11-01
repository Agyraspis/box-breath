import { formatClock, type SessionView } from '../session';
import { byId, setText } from './dom';

/**
 * Corners of the box in the SVG's 0–100 space. The dot climbs the left side on
 * Inhale, crosses the top on Hold, descends the right side on Exhale and
 * returns along the bottom on the second Hold.
 */
const CORNERS: readonly (readonly [number, number])[] = [
  [6, 94],
  [6, 6],
  [94, 6],
  [94, 94],
];

/** Session state: phase label, countdown, progress line, moving dot, Pause/Resume and Stop. */
export class SessionScreen {
  readonly pauseButton = byId<HTMLButtonElement>('pause');
  readonly stopButton = byId<HTMLButtonElement>('stop');
  private readonly root = byId('session');
  private readonly phase = byId('phase-name');
  private readonly countdown = byId('countdown');
  private readonly progress = byId('progress');
  private readonly dot = byId<SVGCircleElement>('box-dot');

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  render(view: SessionView, paused: boolean): void {
    const done = view.stage === 'done';
    this.root.classList.toggle('is-paused', paused);
    this.root.classList.toggle('is-done', done);
    setText(this.phase, view.label);
    setText(this.countdown, done ? '' : String(view.secondsLeft));
    setText(this.progress, done ? '' : `Round ${view.round} of ${view.rounds} · ${formatClock(view.totalLeft)} left`);
    setText(this.pauseButton, paused ? 'Resume' : 'Pause');
    this.pauseButton.disabled = done;

    const [x, y] = this.dotPosition(view);
    this.dot.setAttribute('cx', x.toFixed(2));
    this.dot.setAttribute('cy', y.toFixed(2));
  }

  private dotPosition(view: SessionView): readonly [number, number] {
    if (view.stage !== 'breathe') return CORNERS[0] as readonly [number, number];
    const from = CORNERS[view.phaseIndex] as readonly [number, number];
    const to = CORNERS[(view.phaseIndex + 1) % CORNERS.length] as readonly [number, number];
    const p = view.phaseProgress;
    return [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p];
  }
}
