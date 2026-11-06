# Box Breathing App — Build Spec

Nov 1, 2026 · @Brandon

## Overview

Build a single-screen, offline-capable web app (PWA) that guides box breathing with a beep at every phase change and a continuous binaural beat underneath. It is for personal use, always with headphones.

**Goals**

- Pick a phase length of 3, 4 or 5 seconds.

- Pick a session length in whole rounds, with the total time shown.

- Pick Morning or Evening, which sets the binaural beat preset.

- A short beep at every transition that tells you which phase is starting. No voice, no music, no other sounds. *(Changed Nov 1, 2026: originally one identical beep; see Transition beep.)*

**Non-goals**

- No accounts, backend, analytics, streaks, history or notifications.

- No custom ratios (e.g. 4-7-8). Box only: all four phases equal.

- No speakers mode. Binaural beats require headphones by design.

**Platform**

A PWA built with Vite + TypeScript and plain DOM (or a tiny framework like Preact). It runs on a phone browser, installs to the home screen, and works offline. All audio is synthesized live with the Web Audio API, so there are no audio files.

## User flow and screens

Two states on one screen: Setup and Session. Settings persist between launches.

**Setup state** (top to bottom)

1.  **Time of day**: segmented control, Morning \| Evening. Default: Morning before 2 pm local time, Evening after; a manual pick always wins.

2.  **Phase length**: segmented control, 3s \| 4s \| 5s. Default 4s. Show the round length beneath it, e.g. "1 round = 16 s".

3.  **Rounds**: stepper (minus / number / plus), range 1–100, default 10. Directly under it show total time, e.g. "10 rounds · 2:40". Add quick presets that snap to the nearest whole rounds: ~2, ~5, ~10, ~20 min. *(Changed Nov 1, 2026: 20 minutes will be the most-used length, so ~20 min was added and the range raised from 1–60 so that 20:00 fits at every phase length: 100 rounds at 3 s, 75 at 4 s, 60 at 5 s.)*

4.  **Volume**: two sliders, Binaural level (default 25%) and Beep level (default 60%).

5.  **Headphones reminder**: one muted line of text, "Use headphones."

6.  **Start** button, large, bottom of screen.

**Session state**

- Large phase label: Inhale / Hold / Exhale / Hold.

- Large countdown of seconds left in the phase (e.g. 4, 3, 2, 1).

- Small line: "Round 3 of 10 · 1:52 left".

- Optional minimal visual: a square outline with a dot moving along one side per phase. Keep it subtle and dark.

- Controls: Pause/Resume and Stop. Stop asks no confirmation and returns to Setup.

- On completion, show "Done" for 3 seconds, then return to Setup.

**Visual style**

Dark background (near black, e.g. \#0d0f12), one soft accent color, large type, no clutter. Screen dims are fine but must not lock (see Technical notes).

## Breathing timing model

One round = 4 equal phases of P seconds, so round length = 4 × P and session length = rounds × 4 × P.

1.  Inhale (P s)

2.  Hold full (P s)

3.  Exhale (P s)

4.  Hold empty (P s)

| Phase length | One round | 5 rounds | 10 rounds | 20 rounds |
|--------------|-----------|----------|-----------|-----------|
| 3 s          | 12 s      | 1:00     | 2:00      | 4:00      |
| 4 s          | 16 s      | 1:20     | 2:40      | 5:20      |
| 5 s          | 20 s      | 1:40     | 3:20      | 6:40      |

**Session timeline**

1.  Tap Start → binaural beat fades in over 6 s. No beep yet; this is the settle-in.

2.  At 6 s → beep, Inhale begins (round 1).

3.  Beep at every phase change, including round boundaries (Hold empty → Inhale).

4.  After the last Hold empty of the last round → one final beep marks the end.

5.  Binaural fades out over 8 s, then the session ends.

Beep count per session = rounds × 4 + 1. The final beep is the original 660 Hz single beep, distinct from the phase beeps.

**Pause/Resume**: pause freezes the phase timer and stops the beep schedule; the binaural keeps playing at its level (it is calming during a pause). Resume restarts the current phase from its beginning, with a beep.

## Audio design

Morning uses an alpha beat that rises from 8 to 12 Hz (calm, then alert); Evening uses a beat that falls from 8 Hz alpha to 5 Hz theta (calm, then drowsy). Only two sounds exist: the binaural tone and the beep.

### Binaural beat

Two pure sine oscillators, one hard-panned to each ear. Left = carrier − beat/2, right = carrier + beat/2. The brain perceives the difference as the beat.

| Preset  | Carrier | Beat at start | Beat at end | Band             | Intent                                 |
|---------|---------|---------------|-------------|------------------|----------------------------------------|
| Morning | 320 Hz  | 8 Hz          | 12 Hz       | low → high alpha | Calm focus that lifts toward alertness |
| Evening | 200 Hz  | 8 Hz          | 5 Hz        | alpha → theta    | Deep calm, winding down toward sleep   |

- Ramp the beat linearly across the breathing portion of the session (first beep to last beep). Use linearRampToValueAtTime on both oscillators' frequencies so the carrier stays fixed.

- For very short sessions (under 2 min), still ramp, just faster.

- The lower Evening carrier sounds warmer and darker; the Morning carrier is brighter. Keep both under 500 Hz, where binaural beats are perceived most clearly.

- Fade in 6 s at start, fade out 8 s at end, using gain ramps. Never start or stop an oscillator at full gain (avoids clicks).

- Master binaural gain at 100% slider ≈ 0.15 linear. It should sit quietly under the beep, never loud.

### Transition beep

- Each beep is one or two sine pips, 140 ms each. Envelope per pip: a 15 ms smooth (raised-cosine) rise, then exponential decay to near silence. *(Rise changed Nov 6, 2026 from a 5 ms linear attack, which Bluetooth AAC turned into audible bursts of noise.)* *(Changed Nov 1, 2026, so you can find your place again if you lose track.)*

  | Phase starting | Beep |
  | --- | --- |
  | Inhale | one pip at 784 Hz |
  | Hold (full) | two pips at 784 Hz, 0.2 s apart |
  | Exhale | one pip at 523 Hz |
  | Hold (empty) | two pips at 523 Hz, 0.2 s apart |
  | End of session | one pip at 660 Hz |

  High pitch = lungs filling or full, low = emptying or empty; one pip = move, two = hold.

- Centered (same signal in both ears), so it never disturbs the binaural stereo image.

- The same in both presets.

- Peak gain at 100% slider ≈ 0.5 linear.

### A note on evidence

Research on binaural beats for relaxation and alertness is mixed and effects are modest. The presets above follow common practice; the breathing itself does most of the work.

## Technical implementation notes

The single most important rule: schedule every beep and ramp on the AudioContext clock (ctx.currentTime), never with setTimeout or setInterval. Timers drift and get throttled; the audio clock does not.

**Audio graph**

- OscillatorNode (L) → StereoPannerNode (pan −1) → binaural GainNode → master GainNode → destination.

- OscillatorNode (R) → StereoPannerNode (pan +1) → same binaural gain.

- Each beep: a fresh short-lived OscillatorNode → its own envelope GainNode → beep GainNode → master. Use a lookahead scheduler (schedule beeps ~1–2 s ahead, refill every ~250 ms) or schedule all beeps at Start for sessions under ~20 min.

- Create/resume the AudioContext inside the Start tap handler (browsers block audio until a user gesture).

**UI sync**

- Drive the label, countdown and progress from requestAnimationFrame, computing the current phase from ctx.currentTime − sessionStart. The UI reads the clock; it never owns it.

**Keeping it running**

- Request a Screen Wake Lock (navigator.wakeLock.request('screen')) on Start; release on Stop/Done; re-request on visibilitychange when the page becomes visible.

- iOS Safari suspends Web Audio when the screen locks or the app is backgrounded. The wake lock is the fix. Document this in the README.

- If the context is interrupted (ctx.state becomes 'interrupted' or 'suspended'), auto-pause the session and show Resume.

**PWA**

- manifest.webmanifest with name "Box Breath", dark theme color, standalone display, 192 and 512 px icons (a simple square outline).

- Service worker caching the app shell so it works fully offline (vite-plugin-pwa is fine).

**Persistence**

- Save time of day (only if manually chosen), phase length, rounds and both volumes to localStorage. Wrap reads/writes in try/catch.

**Code layout (suggested)**

- src/audio/engine.ts: context, binaural, beep, scheduling, fades.

- src/session.ts: pure timing math (phase at time t, totals). Unit-test this.

- src/presets.ts: Morning/Evening constants from the Audio design table.

- src/ui/: setup and session views.

No other dependencies needed.

## Acceptance criteria

The build is done when every box below passes on a real phone with headphones.

- [ ] Phase length offers exactly 3, 4 and 5 s; rounds stepper runs 1–100; ~20 min snaps to 20:00 at every phase length; total time updates live and equals rounds × 4 × P.

- [ ] Morning/Evening auto-defaults by time of day; a manual choice persists across reloads.

- [ ] Exactly rounds × 4 + 1 beeps per session, each matching the phase it starts (see Transition beep), none at the 6 s fade-in.

- [ ] 10 rounds at 4 s ends within ±50 ms of 2:40 after the first beep (check with a screen recording or audio capture).

- [ ] Left ear carries the lower frequency, right ear the higher; the difference matches the preset at start and end of the ramp.

- [ ] No clicks or pops at fade-in, fade-out, pause, resume or stop.

- [ ] Screen does not lock during a session; audio keeps going for a 20-minute session.

- [ ] Pause/Resume and Stop behave as specified; Stop returns to Setup immediately.

- [ ] App loads and runs with the network off after first visit; installs to the home screen.

- [ ] Unit tests cover the timing math: phase and seconds left at any time t, totals, and the beat-frequency value at any point in the ramp.

## Prompt for Claude Code

Export this doc as Markdown, save it as SPEC.md in an empty folder, then paste this:

Read SPEC.md fully. Build the box breathing PWA it describes, exactly as specified:  
Vite + TypeScript, Web Audio API only, no audio files, no extra dependencies beyond  
vite-plugin-pwa and a test runner (Vitest).  
  
Order of work:  
1. Scaffold the project and write src/session.ts (pure timing math) with Vitest tests.  
2. Build src/audio/engine.ts: binaural presets with frequency ramps, beep, fades,  
all scheduled on the AudioContext clock.  
3. Build the Setup and Session UI.  
4. Add wake lock, PWA manifest, service worker, localStorage persistence.  
5. Run the tests, then walk through every Acceptance criteria item and report  
which pass and which need checking on a real phone.  
  
Ask me before deviating from the spec. Write a short README with run, build and  
install-to-phone steps, including the iOS screen-lock note.
