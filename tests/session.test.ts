import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PHASE_LENGTH,
  DEFAULT_ROUNDS,
  MAX_ROUNDS,
  MIN_ROUNDS,
  PHASE_LENGTHS,
  PRESET_MINUTES,
  SETTLE_SECONDS,
  beatAt,
  beepCount,
  beepKind,
  beepPlan,
  beepTimes,
  breathingSeconds,
  clampRounds,
  finalBeepTime,
  formatClock,
  resumeTime,
  roundSeconds,
  roundsForMinutes,
  sessionEndTime,
  viewAt,
} from '../src/session';

const MORNING = { beatStart: 8, beatEnd: 12 };
const EVENING = { beatStart: 8, beatEnd: 5 };

describe('settings ranges', () => {
  it('offers exactly 3, 4 and 5 s phases, default 4 s', () => {
    expect([...PHASE_LENGTHS]).toEqual([3, 4, 5]);
    expect(DEFAULT_PHASE_LENGTH).toBe(4);
  });

  it('runs the rounds stepper from 1 to 100, default 10', () => {
    expect([MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS]).toEqual([1, 100, 10]);
    expect(clampRounds(0)).toBe(1);
    expect(clampRounds(101)).toBe(100);
    expect(clampRounds(10.4)).toBe(10);
    expect(clampRounds(Number.NaN)).toBe(10);
  });
});

describe('totals', () => {
  // SPEC.md → Breathing timing model table.
  const table: [number, number, string, string, string][] = [
    [3, 12, '1:00', '2:00', '4:00'],
    [4, 16, '1:20', '2:40', '5:20'],
    [5, 20, '1:40', '3:20', '6:40'],
  ];

  it.each(table)('P = %i s: round %i s, 5/10/20 rounds = %s / %s / %s', (p, round, r5, r10, r20) => {
    expect(roundSeconds(p)).toBe(round);
    expect(formatClock(breathingSeconds(p, 5))).toBe(r5);
    expect(formatClock(breathingSeconds(p, 10))).toBe(r10);
    expect(formatClock(breathingSeconds(p, 20))).toBe(r20);
  });

  it('total equals rounds × 4 × P for every allowed setting', () => {
    for (const p of PHASE_LENGTHS) {
      for (let rounds = MIN_ROUNDS; rounds <= MAX_ROUNDS; rounds++) {
        expect(breathingSeconds(p, rounds)).toBe(rounds * 4 * p);
      }
    }
  });

  it('fits 20:00 at every phase length; the longest session is 100 rounds × 5 s = 33:20', () => {
    expect(formatClock(breathingSeconds(3, 100))).toBe('20:00');
    expect(formatClock(breathingSeconds(4, 75))).toBe('20:00');
    expect(formatClock(breathingSeconds(5, 60))).toBe('20:00');
    expect(formatClock(breathingSeconds(5, MAX_ROUNDS))).toBe('33:20');
  });

  it('formats m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(16)).toBe('0:16');
    expect(formatClock(59)).toBe('0:59');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(112)).toBe('1:52');
  });

  it('places the final beep and the end of the fade-out', () => {
    expect(finalBeepTime(4, 10)).toBe(SETTLE_SECONDS + 160);
    expect(sessionEndTime(4, 10)).toBe(SETTLE_SECONDS + 160 + 8);
  });
});

describe('beeps', () => {
  it('has rounds × 4 + 1 beeps', () => {
    for (let rounds = MIN_ROUNDS; rounds <= MAX_ROUNDS; rounds++) {
      expect(beepCount(rounds)).toBe(rounds * 4 + 1);
      expect(beepTimes(4, rounds)).toHaveLength(rounds * 4 + 1);
    }
  });

  it('first beep at 6 s, none during the fade-in, then one every P seconds', () => {
    for (const p of PHASE_LENGTHS) {
      const times = beepTimes(p, 7);
      expect(times[0]).toBe(6);
      expect(times.every((t) => t >= SETTLE_SECONDS)).toBe(true);
      times.slice(1).forEach((t, i) => expect(t - (times[i] as number)).toBe(p));
    }
  });

  it('10 rounds at 4 s: the final beep is exactly 2:40 after the first', () => {
    const times = beepTimes(4, 10);
    expect((times.at(-1) as number) - (times[0] as number)).toBe(160);
    expect(times.at(-1)).toBe(finalBeepTime(4, 10));
  });
});

describe('beep kinds', () => {
  it('each beep names the phase that starts, and the last marks the end', () => {
    expect(beepPlan(4, 2).map((b) => b.kind)).toEqual([
      'inhale', 'holdFull', 'exhale', 'holdEmpty',
      'inhale', 'holdFull', 'exhale', 'holdEmpty',
      'end',
    ]);
    expect(beepPlan(4, 2).map((b) => b.t)).toEqual(beepTimes(4, 2));
  });

  it('matches the phase shown on screen at every beep', () => {
    for (const p of PHASE_LENGTHS) {
      beepPlan(p, 5).forEach(({ t, kind }, k) => {
        const v = viewAt(t, p, 5);
        if (kind === 'end') expect(v.stage).toBe('done');
        else expect(['inhale', 'holdFull', 'exhale', 'holdEmpty'][v.phaseIndex]).toBe(kind);
        expect(beepKind(k, 5)).toBe(kind);
      });
    }
  });
});

describe('viewAt: phase and seconds left at time t', () => {
  it('counts down the 6 s settle-in before the first beep', () => {
    expect(viewAt(0, 4, 10)).toMatchObject({ stage: 'settle', label: 'Settle in', secondsLeft: 6, round: 1 });
    expect(viewAt(0.5, 4, 10).secondsLeft).toBe(6);
    expect(viewAt(4.2, 4, 10).secondsLeft).toBe(2);
    expect(viewAt(5.999, 4, 10).secondsLeft).toBe(1);
    expect(viewAt(3, 4, 10).totalLeft).toBe(160);
  });

  it('starts Inhale, round 1 at the first beep', () => {
    expect(viewAt(6, 4, 10)).toEqual({
      stage: 'breathe',
      phaseIndex: 0,
      label: 'Inhale',
      secondsLeft: 4,
      phaseProgress: 0,
      round: 1,
      rounds: 10,
      totalLeft: 160,
    });
  });

  it('shows 4, 3, 2, 1 across a 4 s phase', () => {
    const shown = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 3.999].map((dt) => viewAt(6 + dt, 4, 10).secondsLeft);
    expect(shown).toEqual([4, 4, 3, 3, 2, 2, 1, 1, 1]);
  });

  it('goes Inhale → Hold → Exhale → Hold, then the next round', () => {
    const at = (t: number) => {
      const v = viewAt(t, 4, 10);
      return [v.label, v.phaseIndex, v.round];
    };
    expect(at(6)).toEqual(['Inhale', 0, 1]);
    expect(at(10)).toEqual(['Hold', 1, 1]);
    expect(at(14)).toEqual(['Exhale', 2, 1]);
    expect(at(18)).toEqual(['Hold', 3, 1]);
    expect(at(22)).toEqual(['Inhale', 0, 2]);
    expect(at(6 + 16 * 9 + 12.5)).toEqual(['Hold', 3, 10]);
  });

  it('snaps float noise onto phase boundaries', () => {
    expect(viewAt(22 - 1e-12, 4, 10)).toMatchObject({ label: 'Inhale', round: 2, secondsLeft: 4 });
  });

  it('reports time left until the final beep', () => {
    expect(viewAt(6 + 48, 4, 10)).toMatchObject({ round: 4, totalLeft: 112 });
    expect(formatClock(viewAt(6 + 47.5, 4, 10).totalLeft)).toBe('1:53');
    expect(viewAt(165.5, 4, 10)).toMatchObject({ round: 10, label: 'Hold', secondsLeft: 1, totalLeft: 1 });
  });

  it('is done from the final beep on', () => {
    expect(viewAt(166, 4, 10)).toMatchObject({ stage: 'done', label: 'Done', secondsLeft: 0, totalLeft: 0 });
    expect(viewAt(170, 4, 10).stage).toBe('done');
  });

  it('stays consistent at any time t for every phase length', () => {
    for (const p of PHASE_LENGTHS) {
      for (const rounds of [1, 2, 7]) {
        const total = breathingSeconds(p, rounds);
        for (let t = SETTLE_SECONDS; t < SETTLE_SECONDS + total; t += 0.125) {
          const v = viewAt(t, p, rounds);
          const elapsed = t - SETTLE_SECONDS;
          const phase = Math.floor(elapsed / p);
          expect(v.stage).toBe('breathe');
          expect(v.phaseIndex).toBe(phase % 4);
          expect(v.round).toBe(Math.floor(phase / 4) + 1);
          expect(v.secondsLeft).toBe(Math.ceil(p - (elapsed - phase * p)));
          expect(v.secondsLeft).toBeGreaterThanOrEqual(1);
          expect(v.secondsLeft).toBeLessThanOrEqual(p);
          expect(v.totalLeft).toBe(Math.ceil(total - elapsed));
          expect(v.phaseProgress).toBeCloseTo((elapsed - phase * p) / p, 9);
        }
      }
    }
  });
});

describe('resumeTime', () => {
  it('restarts the current phase from its beginning', () => {
    expect(resumeTime(6 + 4 * 7 + 1.3, 4)).toBe(6 + 28);
    expect(resumeTime(6 + 3.99, 4)).toBe(6);
    expect(resumeTime(6 + 8, 4)).toBe(6 + 8);
    expect(resumeTime(6 + 15 - 1e-12, 5)).toBe(6 + 15);
  });

  it('restarts the settle-in if paused before the first beep', () => {
    expect(resumeTime(0, 4)).toBe(0);
    expect(resumeTime(5.9, 3)).toBe(0);
  });
});

describe('beatAt: beat frequency at any point in the ramp', () => {
  it('holds the start value through the settle-in', () => {
    expect(beatAt(0, 4, 10, MORNING)).toBe(8);
    expect(beatAt(5.9, 4, 10, EVENING)).toBe(8);
  });

  it('ramps linearly from the first beep to the final beep', () => {
    expect(beatAt(6, 4, 10, MORNING)).toBe(8);
    expect(beatAt(6 + 40, 4, 10, MORNING)).toBe(9);
    expect(beatAt(6 + 80, 4, 10, MORNING)).toBe(10);
    expect(beatAt(6 + 160, 4, 10, MORNING)).toBe(12);
    expect(beatAt(6 + 80, 4, 10, EVENING)).toBe(6.5);
    expect(beatAt(6 + 160, 4, 10, EVENING)).toBe(5);
    for (let x = 0; x <= 1; x += 0.05) {
      expect(beatAt(6 + 160 * x, 4, 10, MORNING)).toBeCloseTo(8 + 4 * x, 9);
      expect(beatAt(6 + 160 * x, 4, 10, EVENING)).toBeCloseTo(8 - 3 * x, 9);
    }
  });

  it('holds the end value through the fade-out', () => {
    expect(beatAt(6 + 160 + 4, 4, 10, MORNING)).toBe(12);
    expect(beatAt(6 + 160 + 8, 4, 10, EVENING)).toBe(5);
  });

  it('still ramps, just faster, in a very short session', () => {
    expect(beatAt(6 + 6, 3, 1, MORNING)).toBe(10);
    expect(beatAt(6 + 12, 3, 1, MORNING)).toBe(12);
  });
});

describe('quick presets snap to the nearest whole rounds', () => {
  it('offers ~2, ~5, ~10 and ~20 min', () => {
    expect([...PRESET_MINUTES]).toEqual([2, 5, 10, 20]);
  });

  const cases: [number, number, number][] = [
    // [minutes, phase, rounds]
    [2, 3, 10],
    [5, 3, 25],
    [10, 3, 50],
    [2, 4, 8], // 7.5 rounds: halves round up → 2:08
    [5, 4, 19], // 18.75 → 19 → 5:04
    [10, 4, 38], // 37.5 → 38 → 10:08
    [2, 5, 6],
    [5, 5, 15],
    [10, 5, 30],
    [20, 3, 100], // 20:00 exactly at every phase length
    [20, 4, 75],
    [20, 5, 60],
  ];

  it.each(cases)('~%i min at %i s → %i rounds', (minutes, p, rounds) => {
    expect(roundsForMinutes(minutes, p)).toBe(rounds);
  });

  it('every preset gives exactly or nearly its length at every phase length', () => {
    for (const minutes of PRESET_MINUTES) {
      for (const p of PHASE_LENGTHS) {
        const seconds = breathingSeconds(p, roundsForMinutes(minutes, p));
        expect(Math.abs(seconds - minutes * 60)).toBeLessThanOrEqual(roundSeconds(p) / 2);
      }
    }
  });

  it('stays within the stepper range', () => {
    expect(roundsForMinutes(100, 3)).toBe(100);
    expect(roundsForMinutes(0, 4)).toBe(1);
  });
});

