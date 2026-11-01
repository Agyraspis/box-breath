import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  loadSettings,
  parseSettings,
  saveSettings,
  serializeSettings,
  type Settings,
} from '../src/settings';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new Error('blocked');
  },
  setItem: (): void => {
    throw new Error('quota');
  },
};

describe('settings', () => {
  it('defaults: auto time of day, 4 s, 10 rounds, binaural 25 %, beep 60 %', () => {
    expect(parseSettings(null)).toEqual({
      timeOfDay: null,
      phaseSeconds: 4,
      rounds: 10,
      binauralVolume: 25,
      beepVolume: 60,
    });
  });

  it('ignores corrupt or invalid values field by field', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings(
        JSON.stringify({ timeOfDay: 'noon', phaseSeconds: 6, rounds: 101, binauralVolume: -1, beepVolume: 30 }),
      ),
    ).toEqual({ ...DEFAULT_SETTINGS, beepVolume: 30 });
    expect(parseSettings(JSON.stringify({ rounds: 2.5 })).rounds).toBe(10);
  });

  it('writes time of day only if it was chosen manually', () => {
    const auto: Settings = { ...DEFAULT_SETTINGS };
    expect(JSON.parse(serializeSettings(auto))).not.toHaveProperty('timeOfDay');
    const manual: Settings = { ...DEFAULT_SETTINGS, timeOfDay: 'evening' };
    expect(JSON.parse(serializeSettings(manual))).toHaveProperty('timeOfDay', 'evening');
  });

  it('round-trips every setting across a reload', () => {
    const storage = memoryStorage();
    const chosen: Settings = { timeOfDay: 'evening', phaseSeconds: 4, rounds: 75, binauralVolume: 10, beepVolume: 90 };
    saveSettings(chosen, storage);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
    expect(loadSettings(storage)).toEqual(chosen);
  });

  it('survives storage that throws', () => {
    expect(loadSettings(throwingStorage)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, throwingStorage)).not.toThrow();
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
