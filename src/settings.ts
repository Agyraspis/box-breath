/** Settings that persist between launches (localStorage, every access guarded). */

import { isTimeOfDay, type TimeOfDay } from './presets';
import {
  DEFAULT_PHASE_LENGTH,
  DEFAULT_ROUNDS,
  MAX_ROUNDS,
  MIN_ROUNDS,
  isPhaseLength,
  type PhaseLength,
} from './session';

export interface Settings {
  /** Only set once the user picks Morning or Evening; null means "by time of day". */
  timeOfDay: TimeOfDay | null;
  phaseSeconds: PhaseLength;
  rounds: number;
  /** Slider positions, 0–100 (%). */
  binauralVolume: number;
  beepVolume: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  timeOfDay: null,
  phaseSeconds: DEFAULT_PHASE_LENGTH,
  rounds: DEFAULT_ROUNDS,
  binauralVolume: 25,
  beepVolume: 60,
};

export const STORAGE_KEY = 'box-breath.settings.v1';

function isVolume(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function isRounds(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_ROUNDS && (value as number) <= MAX_ROUNDS;
}

/** Each field is validated on its own; anything missing or invalid falls back to its default. */
export function parseSettings(raw: string | null): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return settings;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return settings;
  }
  if (typeof data !== 'object' || data === null) return settings;
  const d = data as Record<string, unknown>;
  if (isTimeOfDay(d.timeOfDay)) settings.timeOfDay = d.timeOfDay;
  if (isPhaseLength(d.phaseSeconds)) settings.phaseSeconds = d.phaseSeconds;
  if (isRounds(d.rounds)) settings.rounds = d.rounds;
  if (isVolume(d.binauralVolume)) settings.binauralVolume = d.binauralVolume;
  if (isVolume(d.beepVolume)) settings.beepVolume = d.beepVolume;
  return settings;
}

/** Time of day is written only if it was chosen manually. */
export function serializeSettings(settings: Settings): string {
  const { timeOfDay, ...rest } = settings;
  return JSON.stringify(timeOfDay === null ? rest : { timeOfDay, ...rest });
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // accessing localStorage itself can throw (blocked storage, some private modes)
  }
}

export function loadSettings(storage: StorageLike | null = defaultStorage()): Settings {
  try {
    return parseSettings(storage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, serializeSettings(settings));
  } catch {
    // Quota exceeded or storage blocked: the app keeps working without persistence.
  }
}
