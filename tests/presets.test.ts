import { describe, expect, it } from 'vitest';
import { PRESETS, defaultTimeOfDay, earFrequencies } from '../src/presets';
import { beatAt, finalBeepTime, SETTLE_SECONDS } from '../src/session';

describe('binaural presets', () => {
  it('match the Audio design table', () => {
    expect(PRESETS.morning).toMatchObject({ carrier: 320, beatStart: 8, beatEnd: 12 });
    expect(PRESETS.evening).toMatchObject({ carrier: 200, beatStart: 8, beatEnd: 5 });
  });

  it('keep both carriers under 500 Hz', () => {
    expect(PRESETS.morning.carrier).toBeLessThan(500);
    expect(PRESETS.evening.carrier).toBeLessThan(500);
  });

  it('put the lower frequency in the left ear and keep the carrier fixed', () => {
    expect(earFrequencies(320, 8)).toEqual({ left: 316, right: 324 });
    expect(earFrequencies(200, 5)).toEqual({ left: 197.5, right: 202.5 });
  });

  it.each([PRESETS.morning, PRESETS.evening])('$label: ear difference equals the beat at ramp start and end', (preset) => {
    const start = earFrequencies(preset.carrier, beatAt(SETTLE_SECONDS, 4, 10, preset));
    const end = earFrequencies(preset.carrier, beatAt(finalBeepTime(4, 10), 4, 10, preset));
    expect(start.right - start.left).toBe(preset.beatStart);
    expect(end.right - end.left).toBe(preset.beatEnd);
    expect((start.left + start.right) / 2).toBe(preset.carrier);
    expect((end.left + end.right) / 2).toBe(preset.carrier);
  });
});

describe('time-of-day default', () => {
  const at = (hours: number, minutes: number) => new Date(2026, 10, 1, hours, minutes);

  it('is Morning before 2 pm local time and Evening from 2 pm', () => {
    expect(defaultTimeOfDay(at(0, 0))).toBe('morning');
    expect(defaultTimeOfDay(at(13, 59))).toBe('morning');
    expect(defaultTimeOfDay(at(14, 0))).toBe('evening');
    expect(defaultTimeOfDay(at(23, 59))).toBe('evening');
  });
});
