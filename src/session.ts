/**
 * Pure timing math for a box breathing session. No DOM, no audio.
 *
 * All times are in seconds on the *session clock*: t = 0 is the Start tap,
 * the settle-in runs from 0 to SETTLE_SECONDS, the first beep (Inhale, round 1)
 * is at SETTLE_SECONDS, and the final beep is at SETTLE_SECONDS + rounds × 4 × P.
 * Paused time is not counted, and Resume rewinds the clock to the start of the
 * current phase, so every function here stays a pure function of t.
 */

export const PHASE_LENGTHS = [3, 4, 5] as const;
export type PhaseLength = (typeof PHASE_LENGTHS)[number];
export const DEFAULT_PHASE_LENGTH: PhaseLength = 4;

export const MIN_ROUNDS = 1;
/** Raised from the spec's 60 so that 20 minutes fits at every phase length (100 × 4 × 3 s). */
export const MAX_ROUNDS = 100;
export const DEFAULT_ROUNDS = 10;

/** Quick presets on the Setup screen, in minutes. 20 minutes is the most-used length. */
export const PRESET_MINUTES = [2, 5, 10, 20] as const;

export const PHASES_PER_ROUND = 4;
export const PHASE_LABELS = ['Inhale', 'Hold', 'Exhale', 'Hold'] as const;
export const SETTLE_LABEL = 'Settle in';
export const DONE_LABEL = 'Done';

/** Settle-in before the first beep; the binaural fades in over the same 6 s. */
export const SETTLE_SECONDS = 6;
export const FADE_IN_SECONDS = 6;
/** After the final beep the binaural fades out over 8 s, then the session ends. */
export const FADE_OUT_SECONDS = 8;
/** "Done" is shown for 3 s after the final beep, then the app returns to Setup. */
export const DONE_SECONDS = 3;

/** Snaps float noise (e.g. 15.9999999999 for 16) onto phase boundaries. */
const EPS = 1e-9;

export function isPhaseLength(value: unknown): value is PhaseLength {
  return (PHASE_LENGTHS as readonly unknown[]).includes(value);
}

/** One round = 4 equal phases of P seconds. */
export function roundSeconds(phaseSeconds: number): number {
  return PHASES_PER_ROUND * phaseSeconds;
}

/** The breathing portion of a session: first beep to final beep. */
export function breathingSeconds(phaseSeconds: number, rounds: number): number {
  return rounds * roundSeconds(phaseSeconds);
}

/** Session-clock time of the final beep. */
export function finalBeepTime(phaseSeconds: number, rounds: number): number {
  return SETTLE_SECONDS + breathingSeconds(phaseSeconds, rounds);
}

/** Session-clock time at which the fade-out finishes and the session ends. */
export function sessionEndTime(phaseSeconds: number, rounds: number): number {
  return finalBeepTime(phaseSeconds, rounds) + FADE_OUT_SECONDS;
}

/** One beep per phase change plus the final beep. */
export function beepCount(rounds: number): number {
  return rounds * PHASES_PER_ROUND + 1;
}

/** Session-clock times of every beep in an uninterrupted session. */
export function beepTimes(phaseSeconds: number, rounds: number): number[] {
  return Array.from({ length: beepCount(rounds) }, (_, k) => SETTLE_SECONDS + k * phaseSeconds);
}

/** Each beep says which phase is starting, so you can find your place again; the last one marks the end. */
export type BeepKind = 'inhale' | 'holdFull' | 'exhale' | 'holdEmpty' | 'end';
const PHASE_BEEPS: readonly BeepKind[] = ['inhale', 'holdFull', 'exhale', 'holdEmpty'];

/** Kind of the k-th beep (0-based) in a session of `rounds` rounds. */
export function beepKind(k: number, rounds: number): BeepKind {
  return k >= rounds * PHASES_PER_ROUND ? 'end' : (PHASE_BEEPS[k % PHASES_PER_ROUND] as BeepKind);
}

/** Every beep of an uninterrupted session: session-clock time and kind. */
export function beepPlan(phaseSeconds: number, rounds: number): { t: number; kind: BeepKind }[] {
  return beepTimes(phaseSeconds, rounds).map((t, k) => ({ t, kind: beepKind(k, rounds) }));
}

export function clampRounds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ROUNDS;
  return Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, Math.round(value)));
}

/** Quick presets: the nearest whole number of rounds (halves round up), within the stepper range. */
export function roundsForMinutes(minutes: number, phaseSeconds: number): number {
  return clampRounds((minutes * 60) / roundSeconds(phaseSeconds));
}

/** Whole seconds as m:ss, e.g. 160 → "2:40". */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** A countdown shows the remaining time rounded up: 4, 3, 2, 1. */
function ceilSeconds(seconds: number): number {
  return Math.max(0, Math.ceil(seconds - 1e-6));
}

export type Stage = 'settle' | 'breathe' | 'done';

export interface SessionView {
  stage: Stage;
  /** 0 Inhale, 1 Hold (full), 2 Exhale, 3 Hold (empty); -1 outside the breathing portion. */
  phaseIndex: number;
  label: string;
  /** Whole seconds left in the current phase (or in the settle-in); 0 when done. */
  secondsLeft: number;
  /** Fraction of the current phase elapsed, 0 to 1 (0 in the settle-in, 1 when done). */
  phaseProgress: number;
  /** 1-based round number. */
  round: number;
  rounds: number;
  /** Whole seconds left until the final beep. Excludes the settle-in and the fade-out. */
  totalLeft: number;
}

/** What the session screen shows at session-clock time t. */
export function viewAt(t: number, phaseSeconds: number, rounds: number): SessionView {
  const total = breathingSeconds(phaseSeconds, rounds);
  const b = t - SETTLE_SECONDS; // seconds since the first beep

  if (b < -EPS) {
    return {
      stage: 'settle',
      phaseIndex: -1,
      label: SETTLE_LABEL,
      secondsLeft: ceilSeconds(-b),
      phaseProgress: 0,
      round: 1,
      rounds,
      totalLeft: total,
    };
  }

  if (b >= total - EPS) {
    return {
      stage: 'done',
      phaseIndex: -1,
      label: DONE_LABEL,
      secondsLeft: 0,
      phaseProgress: 1,
      round: rounds,
      rounds,
      totalLeft: 0,
    };
  }

  const elapsed = Math.max(0, b);
  const globalPhase = Math.floor((elapsed + EPS) / phaseSeconds);
  const inPhase = Math.max(0, elapsed - globalPhase * phaseSeconds);
  const phaseIndex = globalPhase % PHASES_PER_ROUND;

  return {
    stage: 'breathe',
    phaseIndex,
    label: PHASE_LABELS[phaseIndex] ?? '',
    secondsLeft: ceilSeconds(phaseSeconds - inPhase),
    phaseProgress: Math.min(1, inPhase / phaseSeconds),
    round: Math.floor(globalPhase / PHASES_PER_ROUND) + 1,
    rounds,
    totalLeft: ceilSeconds(total - elapsed),
  };
}

/**
 * Session-clock time to continue from after a pause at t: the start of the
 * current phase ("Resume restarts the current phase from its beginning").
 * A pause during the settle-in restarts the settle-in.
 */
export function resumeTime(t: number, phaseSeconds: number): number {
  const b = t - SETTLE_SECONDS;
  if (b < -EPS) return 0;
  const globalPhase = Math.floor((Math.max(0, b) + EPS) / phaseSeconds);
  return SETTLE_SECONDS + globalPhase * phaseSeconds;
}

export interface BeatRamp {
  beatStart: number;
  beatEnd: number;
}

/**
 * Binaural beat frequency at session-clock time t. It holds at beatStart through
 * the settle-in, ramps linearly from the first beep to the final beep, and holds
 * at beatEnd through the fade-out.
 */
export function beatAt(t: number, phaseSeconds: number, rounds: number, ramp: BeatRamp): number {
  const progress = (t - SETTLE_SECONDS) / breathingSeconds(phaseSeconds, rounds);
  const x = Math.min(1, Math.max(0, progress));
  return ramp.beatStart + (ramp.beatEnd - ramp.beatStart) * x;
}
