/**
 * Web Audio engine: context, binaural voice, beeps, scheduling and fades.
 *
 * Every beep, ramp and fade is scheduled on the AudioContext clock
 * (ctx.currentTime). Beeps go through a lookahead scheduler: a 250 ms timer
 * keeps the next 2 s of beeps scheduled, but each beep starts at its exact
 * audio-clock time. No timer ever decides when something is heard.
 *
 * Graph (SPEC.md → Technical implementation notes):
 *   OscillatorNode L → StereoPannerNode (−1) ┐
 *   OscillatorNode R → StereoPannerNode (+1) ┴→ binaural GainNode → master GainNode → destination
 *   per beep: OscillatorNode → envelope GainNode → beep GainNode → master GainNode
 */

import { earFrequencies, type BinauralPreset } from '../presets';
import type { BeepKind } from '../session';
import {
  FADE_IN_SECONDS,
  FADE_OUT_SECONDS,
  SETTLE_SECONDS,
  beatAt,
  beepPlan,
  finalBeepTime,
  resumeTime,
} from '../session';

/**
 * Transition beeps: sine pips of 140 ms, 5 ms linear attack, exponential decay.
 * Pitch tells full from empty (high going into or holding a full breath, low
 * going into or holding an empty one); one pip means move, two mean hold. The
 * end of the session keeps the original 660 Hz single beep.
 */
export const BEEP_TONES: Readonly<Record<BeepKind, { frequency: number; pips: number }>> = {
  inhale: { frequency: 784, pips: 1 },
  holdFull: { frequency: 784, pips: 2 },
  exhale: { frequency: 523, pips: 1 },
  holdEmpty: { frequency: 523, pips: 2 },
  end: { frequency: 660, pips: 1 },
};
/** Start-to-start spacing of the two pips of a hold beep (140 ms pip + 60 ms gap). */
export const PIP_SPACING_SECONDS = 0.2;
export const BEEP_SECONDS = 0.14;
export const BEEP_ATTACK_SECONDS = 0.005;
/** "Near silence" at the end of the decay (−80 dB). */
export const BEEP_FLOOR = 0.0001;

/** Linear gain with each slider at 100 %. */
export const BINAURAL_MAX_GAIN = 0.15;
export const BEEP_MAX_GAIN = 0.5;

/** Stop returns to Setup at once; the binaural still ramps to silence so it cannot click. */
export const STOP_FADE_SECONDS = 1;

/**
 * Lookahead scheduler: beeps are scheduled this far ahead... (Scheduling every
 * beep at Start keeps up to 401 waiting nodes in the graph, and the audio thread
 * processes each of them on every render quantum.)
 */
export const LOOKAHEAD_SECONDS = 2;
/** ...and the window is refilled this often. */
export const REFILL_MS = 250;

/** Every event is scheduled at least this far ahead of the audio clock. */
const LEAD_SECONDS = 0.05;
/** A beep this close to "now" may already be rendering; let it finish instead of cutting it. */
const CANCEL_MARGIN_SECONDS = 0.02;
/** Oscillators stop this long after their gain has reached zero. */
const STOP_PAD_SECONDS = 0.05;

export interface SessionPlan {
  preset: BinauralPreset;
  phaseSeconds: number;
  rounds: number;
  /** Slider positions, 0–1. */
  binauralVolume: number;
  beepVolume: number;
}

type HoldableParam = AudioParam & { cancelAndHoldAtTime?: (cancelTime: number) => AudioParam };

/**
 * Drop automation after `time` and hold `value` (the value scheduled for that
 * time) from there, without a jump. cancelAndHoldAtTime keeps the timeline
 * gap-free while it is edited, but it does not always leave an event at `time`
 * (not when the cancelled event after it is a setValueAtTime), and a following
 * ramp would then start from the last event before `time`. So `value` is always
 * pinned at `time` explicitly.
 */
function holdAt(param: AudioParam, time: number, value: number): void {
  const p = param as HoldableParam;
  if (typeof p.cancelAndHoldAtTime === 'function') {
    p.cancelAndHoldAtTime(time);
  } else {
    p.cancelScheduledValues(time);
  }
  p.setValueAtTime(value, time);
}

/** Two sines, one hard-panned to each ear, sharing one fade/level gain. */
class BinauralVoice {
  private readonly left: OscillatorNode;
  private readonly right: OscillatorNode;
  private readonly gain: GainNode;
  private fadeInStart = Infinity;
  private fadeInEnd = Infinity;
  private fadeOutStart = Infinity;
  private fadeOutEnd = Infinity;
  private stopTime = Infinity;
  onEnded: (() => void) | null = null;

  constructor(
    ctx: BaseAudioContext,
    output: AudioNode,
    private readonly carrier: number,
    private readonly level: number,
  ) {
    this.left = ctx.createOscillator();
    this.right = ctx.createOscillator();
    const panLeft = ctx.createStereoPanner();
    const panRight = ctx.createStereoPanner();
    panLeft.pan.value = -1;
    panRight.pan.value = 1;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.left.connect(panLeft).connect(this.gain);
    this.right.connect(panRight).connect(this.gain);
    this.gain.connect(output);
    this.right.onended = () => {
      for (const node of [this.left, this.right, panLeft, panRight, this.gain]) node.disconnect();
      this.onEnded?.();
    };
  }

  /** Start both oscillators at zero gain and fade in to the binaural level. */
  start(at: number, fadeSeconds: number, beat: number): void {
    const f = earFrequencies(this.carrier, beat);
    this.left.frequency.value = f.left;
    this.right.frequency.value = f.right;
    this.gain.gain.setValueAtTime(0, at);
    this.gain.gain.linearRampToValueAtTime(this.level, at + fadeSeconds);
    this.fadeInStart = at;
    this.fadeInEnd = at + fadeSeconds;
    this.left.start(at);
    this.right.start(at);
  }

  setBeat(beat: number, at: number): void {
    const f = earFrequencies(this.carrier, beat);
    this.left.frequency.setValueAtTime(f.left, at);
    this.right.frequency.setValueAtTime(f.right, at);
  }

  /** Both ears ramp linearly, so the carrier stays fixed and the beat ramps linearly. */
  rampBeat(beat: number, at: number): void {
    const f = earFrequencies(this.carrier, beat);
    this.left.frequency.linearRampToValueAtTime(f.left, at);
    this.right.frequency.linearRampToValueAtTime(f.right, at);
  }

  holdBeat(beat: number, at: number): void {
    const f = earFrequencies(this.carrier, beat);
    holdAt(this.left.frequency, at, f.left);
    holdAt(this.right.frequency, at, f.right);
  }

  scheduleFadeOut(at: number, seconds: number): void {
    this.gain.gain.setValueAtTime(this.level, at);
    this.gain.gain.linearRampToValueAtTime(0, at + seconds);
    this.fadeOutStart = at;
    this.fadeOutEnd = at + seconds;
  }

  cancelFadeOut(): void {
    if (this.fadeOutStart === Infinity) return;
    this.gain.gain.cancelScheduledValues(this.fadeOutStart);
    this.fadeOutStart = Infinity;
    this.fadeOutEnd = Infinity;
  }

  /** Ramp from wherever the gain is now to silence, then stop. */
  release(now: number, seconds: number): void {
    holdAt(this.gain.gain, now, this.gainAt(now));
    this.gain.gain.linearRampToValueAtTime(0, now + seconds);
    this.stopAt(now + seconds + STOP_PAD_SECONDS);
  }

  /** Stop the oscillators; only called for a time when the gain is already zero. */
  stopAt(at: number): void {
    if (this.stopTime !== Infinity) return;
    this.stopTime = at;
    this.left.stop(at);
    this.right.stop(at);
  }

  /** The scheduled gain at time t (used where cancelAndHoldAtTime is missing). */
  private gainAt(t: number): number {
    if (t >= this.fadeOutEnd) return 0;
    if (t > this.fadeOutStart) {
      return (this.level * (this.fadeOutEnd - t)) / (this.fadeOutEnd - this.fadeOutStart);
    }
    if (t <= this.fadeInStart) return 0;
    if (t >= this.fadeInEnd) return this.level;
    return (this.level * (t - this.fadeInStart)) / (this.fadeInEnd - this.fadeInStart);
  }
}

interface ScheduledBeep {
  osc: OscillatorNode;
  env: GainNode;
  /** Start of the beep this pip belongs to: a hold's second pip is never cut once its first has started. */
  at: number;
}

/**
 * One session's audio. It maps the session clock (see session.ts) onto the
 * audio clock: session time anchorT happens at audio time anchorCtx. Pause
 * freezes the session clock; Resume re-anchors it at the start of the current
 * phase and schedules everything that remains from there.
 */
export class SessionPlayer {
  readonly plan: SessionPlan;
  /** Session-clock time of the final beep. */
  readonly finalTime: number;
  private readonly ctx: BaseAudioContext;
  private readonly voice: BinauralVoice;
  private readonly beepBus: GainNode;
  private beeps: ScheduledBeep[] = [];
  /** Session times of the beeps from the current anchor onward; those before nextBeep are scheduled. */
  private beepQueue: { t: number; kind: BeepKind }[] = [];
  private nextBeep = 0;
  private refillTimer: ReturnType<typeof setTimeout> | undefined;
  private anchorT = 0;
  private anchorCtx = 0;
  private pausedT: number | null = null;
  private stopped = false;
  private finalizeTimer: ReturnType<typeof setTimeout> | undefined;
  /** Called once the binaural has faded to silence and its nodes are released. */
  onSilent: (() => void) | null = null;

  constructor(ctx: BaseAudioContext, output: AudioNode, plan: SessionPlan) {
    this.ctx = ctx;
    this.plan = plan;
    this.finalTime = finalBeepTime(plan.phaseSeconds, plan.rounds);
    this.beepBus = ctx.createGain();
    this.beepBus.gain.value = BEEP_MAX_GAIN * plan.beepVolume;
    this.beepBus.connect(output);
    this.voice = new BinauralVoice(ctx, output, plan.preset.carrier, BINAURAL_MAX_GAIN * plan.binauralVolume);
    this.voice.onEnded = () => {
      this.beepBus.disconnect();
      this.onSilent?.();
    };
  }

  get paused(): boolean {
    return this.pausedT !== null;
  }


  /** Session-clock time now. */
  time(): number {
    if (this.pausedT !== null) return this.pausedT;
    return Math.max(this.anchorT, this.anchorT + (this.ctx.currentTime - this.anchorCtx));
  }

  /** Audio-clock time at which session time t happens (while running). */
  ctxTimeOf(t: number): number {
    return this.anchorCtx + (t - this.anchorT);
  }

  /** Tap Start: 6 s binaural fade-in (no beep), then the first beep and Inhale. */
  start(): void {
    const at = this.ctx.currentTime + LEAD_SECONDS;
    this.voice.start(at, FADE_IN_SECONDS, this.beat(0));
    this.runFrom(0, at);
  }

  /** Freeze the phase timer and cancel pending beeps; the binaural keeps playing. */
  pause(): boolean {
    if (this.stopped || this.pausedT !== null) return false;
    const t = this.time();
    if (t >= this.finalTime) return false; // the final beep has sounded
    const now = this.ctx.currentTime;
    this.pausedT = t;
    clearTimeout(this.finalizeTimer);
    clearTimeout(this.refillTimer);
    this.cancelBeeps(now);
    this.voice.holdBeat(this.beat(t), now);
    this.voice.cancelFadeOut();
    return true;
  }

  /** Restart the current phase from its beginning, with a beep. */
  resume(): boolean {
    if (this.stopped || this.pausedT === null) return false;
    this.runFrom(resumeTime(this.pausedT, this.plan.phaseSeconds), this.ctx.currentTime + LEAD_SECONDS);
    return true;
  }

  /** Cancel pending beeps and ramp the binaural to silence (unless it is already fading out). */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.finalizeTimer);
    clearTimeout(this.refillTimer);
    const now = this.ctx.currentTime;
    this.cancelBeeps(now);
    const fadeOutStart = this.pausedT === null ? this.ctxTimeOf(this.finalTime) : Infinity;
    if (now >= fadeOutStart) {
      this.voice.stopAt(fadeOutStart + FADE_OUT_SECONDS + STOP_PAD_SECONDS);
    } else {
      this.voice.release(now, STOP_FADE_SECONDS);
    }
  }

  private beat(t: number): number {
    return beatAt(t, this.plan.phaseSeconds, this.plan.rounds, this.plan.preset);
  }

  /** Schedule everything from session time t (at audio time `at`) to the end of the session. */
  private runFrom(t: number, at: number): void {
    this.anchorT = t;
    this.anchorCtx = at;
    this.pausedT = null;

    // Beat: the value for t, held through any settle-in, then one linear ramp
    // that reaches the preset's end value exactly at the final beep.
    const rampFrom = Math.max(t, SETTLE_SECONDS);
    this.voice.setBeat(this.beat(t), at);
    if (rampFrom > t) this.voice.setBeat(this.beat(rampFrom), this.ctxTimeOf(rampFrom));
    this.voice.rampBeat(this.beat(this.finalTime), this.ctxTimeOf(this.finalTime));

    // Every remaining beep, fed onto the audio clock through the lookahead window.
    this.beepQueue = beepPlan(this.plan.phaseSeconds, this.plan.rounds).filter((beep) => beep.t >= t - 1e-9);
    this.nextBeep = 0;
    this.refill();

    this.voice.scheduleFadeOut(this.ctxTimeOf(this.finalTime), FADE_OUT_SECONDS);
    this.armFinalize();
  }

  /**
   * Schedule the queued beeps that fall inside the lookahead window, then come
   * back in REFILL_MS if any are left. The timer only decides when a beep gets
   * scheduled; each beep still starts at its exact audio-clock time.
   */
  private refill(): void {
    clearTimeout(this.refillTimer);
    if (this.stopped || this.pausedT !== null) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD_SECONDS;
    while (this.nextBeep < this.beepQueue.length) {
      const beep = this.beepQueue[this.nextBeep] as { t: number; kind: BeepKind };
      const at = this.ctxTimeOf(beep.t);
      if (at > horizon) break;
      this.nextBeep += 1;
      // Only possible if the page stalled for well over a second: a beep that can
      // no longer start on time is skipped rather than played late.
      if (at < now + LEAD_SECONDS / 2) continue;
      this.scheduleBeep(at, beep.kind);
    }
    if (this.nextBeep < this.beepQueue.length) {
      this.refillTimer = setTimeout(() => this.refill(), REFILL_MS);
    }
  }

  private scheduleBeep(at: number, kind: BeepKind): void {
    const tone = BEEP_TONES[kind];
    for (let pip = 0; pip < tone.pips; pip++) {
      const start = at + pip * PIP_SPACING_SECONDS;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = tone.frequency;
      const env = this.ctx.createGain();
      env.gain.value = 0;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(1, start + BEEP_ATTACK_SECONDS);
      env.gain.exponentialRampToValueAtTime(BEEP_FLOOR, start + BEEP_SECONDS);
      osc.connect(env).connect(this.beepBus);
      osc.start(start);
      osc.stop(start + BEEP_SECONDS);
      const beep: ScheduledBeep = { osc, env, at };
      this.beeps.push(beep);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
        this.beeps = this.beeps.filter((b) => b !== beep);
      };
    }
  }

  private cancelBeeps(now: number): void {
    const kept: ScheduledBeep[] = [];
    for (const beep of this.beeps) {
      if (beep.at > now + CANCEL_MARGIN_SECONDS) {
        beep.osc.onended = null;
        try {
          beep.osc.stop();
        } catch {
          // Some engines reject a second stop(); disconnecting below silences it anyway.
        }
        beep.osc.disconnect();
        beep.env.disconnect();
      } else {
        kept.push(beep);
      }
    }
    this.beeps = kept;
  }

  /**
   * Once the final beep has sounded nothing can reschedule the fade-out, so the
   * oscillators can be told to stop after it. Their gain is zero by then, so a
   * late timer is harmless.
   */
  private armFinalize(): void {
    clearTimeout(this.finalizeTimer);
    const wait = Math.max(0, this.ctxTimeOf(this.finalTime) - this.ctx.currentTime);
    this.finalizeTimer = setTimeout(() => this.finalize(), wait * 1000 + 250);
  }

  private finalize(): void {
    if (this.stopped || this.pausedT !== null) return;
    const fadeOutStart = this.ctxTimeOf(this.finalTime);
    if (this.ctx.currentTime < fadeOutStart) {
      this.armFinalize(); // the audio clock runs a little behind the wall clock
      return;
    }
    this.voice.stopAt(fadeOutStart + FADE_OUT_SECONDS + STOP_PAD_SECONDS);
  }
}

type NavigatorWithAudioSession = Navigator & { audioSession?: { type: string } };

/**
 * iOS 17+ only: use the "playback" audio session so the Ring/Silent switch does
 * not mute the app (Web Audio otherwise behaves like a game and is silenced).
 */
function preferPlaybackAudioSession(): void {
  try {
    const session = (navigator as NavigatorWithAudioSession).audioSession;
    if (session) session.type = 'playback';
  } catch {
    // Not supported: nothing to do.
  }
}

/** Owns the one AudioContext and the master gain. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Players whose audio has not finished yet. */
  private live = 0;
  /** True while our own idle suspend() is pending or in effect. */
  private suspending = false;
  /** The browser suspended or interrupted audio (a call, Siri, screen lock, backgrounding). */
  onInterrupted: (() => void) | null = null;

  /**
   * Create or resume the AudioContext. Call it synchronously inside a tap
   * handler: browsers only allow audio to start from a user gesture.
   */
  unlock(): Promise<void> {
    const ctx = this.context();
    return ctx.resume().catch(() => undefined);
  }

  get state(): string {
    return this.ctx?.state ?? 'closed';
  }

  startSession(plan: SessionPlan): SessionPlayer {
    const ctx = this.context();
    const player = new SessionPlayer(ctx, this.master as GainNode, plan);
    this.live += 1;
    player.onSilent = () => {
      this.live -= 1;
      this.suspendIfIdle();
    };
    player.start();
    return player;
  }

  private context(): AudioContext {
    if (this.ctx) return this.ctx;
    preferPlaybackAudioSession();
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') {
        this.suspending = false;
        return;
      }
      // 'suspended', or Safari's 'interrupted'.
      if (!this.suspending) this.onInterrupted?.();
    });
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /** Let the audio hardware sleep between sessions; the next Start resumes it. */
  private suspendIfIdle(): void {
    if (this.live > 0 || !this.ctx || this.ctx.state !== 'running') return;
    this.suspending = true;
    this.ctx.suspend().catch(() => undefined);
  }
}
