/** Morning/Evening binaural presets (SPEC.md → Audio design → Binaural beat). */

export type TimeOfDay = 'morning' | 'evening';

export interface BinauralPreset {
  id: TimeOfDay;
  label: string;
  /** Hz. Left ear = carrier − beat/2, right ear = carrier + beat/2. */
  carrier: number;
  /** Beat in Hz at the first beep. */
  beatStart: number;
  /** Beat in Hz at the final beep. */
  beatEnd: number;
  band: string;
  intent: string;
}

export const PRESETS: Readonly<Record<TimeOfDay, BinauralPreset>> = {
  morning: {
    id: 'morning',
    label: 'Morning',
    carrier: 320,
    beatStart: 8,
    beatEnd: 12,
    band: 'low → high alpha',
    intent: 'Calm focus that lifts toward alertness',
  },
  evening: {
    id: 'evening',
    label: 'Evening',
    carrier: 200,
    beatStart: 8,
    beatEnd: 5,
    band: 'alpha → theta',
    intent: 'Deep calm, winding down toward sleep',
  },
};

/** Morning before 2 pm local time, Evening from 2 pm. */
export const EVENING_FROM_HOUR = 14;

export function isTimeOfDay(value: unknown): value is TimeOfDay {
  return value === 'morning' || value === 'evening';
}

export function defaultTimeOfDay(now: Date): TimeOfDay {
  return now.getHours() < EVENING_FROM_HOUR ? 'morning' : 'evening';
}

/** Per-ear oscillator frequencies; the brain hears the difference as the beat. */
export function earFrequencies(carrier: number, beat: number): { left: number; right: number } {
  return { left: carrier - beat / 2, right: carrier + beat / 2 };
}
