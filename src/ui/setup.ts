import { defaultTimeOfDay, isTimeOfDay, type TimeOfDay } from '../presets';
import {
  MAX_ROUNDS,
  MIN_ROUNDS,
  PRESET_MINUTES,
  breathingSeconds,
  clampRounds,
  formatClock,
  roundSeconds,
  roundsForMinutes,
} from '../session';
import type { Settings } from '../settings';
import { byId, onRadio, setChecked, setText } from './dom';

/** Setup state: time of day, phase length, rounds, volumes, Start. */
export class SetupView {
  private settings: Settings;
  private readonly root = byId('setup');
  private readonly timeOfDayGroup = byId('tod');
  private readonly phaseGroup = byId('phase');
  private readonly roundLength = byId('round-length');
  private readonly roundsValue = byId('rounds-value');
  private readonly minus = byId<HTMLButtonElement>('rounds-minus');
  private readonly plus = byId<HTMLButtonElement>('rounds-plus');
  private readonly totalTime = byId('total-time');
  private readonly binaural = byId<HTMLInputElement>('binaural');
  private readonly binauralValue = byId('binaural-value');
  private readonly beep = byId<HTMLInputElement>('beep');
  private readonly beepValue = byId('beep-value');

  constructor(
    initial: Settings,
    private readonly onChange: (settings: Settings) => void,
    onStart: () => void,
  ) {
    this.settings = { ...initial };

    // A manual pick always wins over the time-of-day default, and is saved.
    onRadio(this.timeOfDayGroup, (value) => {
      if (isTimeOfDay(value)) this.update({ timeOfDay: value });
    });
    onRadio(this.phaseGroup, (value) => {
      const p = Number(value);
      if (p === 3 || p === 4 || p === 5) this.update({ phaseSeconds: p });
    });
    this.minus.addEventListener('click', () => this.update({ rounds: clampRounds(this.settings.rounds - 1) }));
    this.plus.addEventListener('click', () => this.update({ rounds: clampRounds(this.settings.rounds + 1) }));
    const presets = byId('presets');
    presets.replaceChildren(
      ...PRESET_MINUTES.map((minutes) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.minutes = String(minutes);
        button.textContent = `~${minutes} min`;
        return button;
      }),
    );
    presets.addEventListener('click', (event) => {
      const minutes = Number((event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.minutes);
      if (minutes > 0) this.update({ rounds: roundsForMinutes(minutes, this.settings.phaseSeconds) });
    });
    this.binaural.addEventListener('input', () => this.update({ binauralVolume: Number(this.binaural.value) }));
    this.beep.addEventListener('input', () => this.update({ beepVolume: Number(this.beep.value) }));
    byId('start').addEventListener('click', onStart);

    this.render();
  }

  get current(): Readonly<Settings> {
    return this.settings;
  }

  /** Morning or Evening: the manual pick if there is one, else by local time (Evening from 2 pm). */
  timeOfDay(now: Date = new Date()): TimeOfDay {
    return this.settings.timeOfDay ?? defaultTimeOfDay(now);
  }

  show(): void {
    this.render(); // the time-of-day default may have changed since the last visit
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    this.onChange(this.settings);
    this.render();
  }

  private render(): void {
    const { phaseSeconds, rounds, binauralVolume, beepVolume } = this.settings;
    setChecked(this.timeOfDayGroup, this.timeOfDay());
    setChecked(this.phaseGroup, String(phaseSeconds));
    setText(this.roundLength, `1 round = ${roundSeconds(phaseSeconds)} s`);
    setText(this.roundsValue, String(rounds));
    this.minus.disabled = rounds <= MIN_ROUNDS;
    this.plus.disabled = rounds >= MAX_ROUNDS;
    setText(
      this.totalTime,
      `${rounds} ${rounds === 1 ? 'round' : 'rounds'} · ${formatClock(breathingSeconds(phaseSeconds, rounds))}`,
    );
    this.binaural.value = String(binauralVolume);
    setText(this.binauralValue, `${Math.round(binauralVolume)}%`);
    this.beep.value = String(beepVolume);
    setText(this.beepValue, `${Math.round(beepVolume)}%`);
  }
}
