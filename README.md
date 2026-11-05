# Box Breath

A single-screen, offline web app (PWA) for box breathing: a beep at every phase change
that tells you which phase is starting, over a quiet binaural beat. Use it with headphones. The full spec is in
[SPEC.md](SPEC.md).

All sound is synthesized live with the Web Audio API, so there are no audio files. Every beep, frequency ramp and
fade is scheduled on the AudioContext clock. The screen only reads that clock.

## Run

Requires Node 22.12 or later.

```sh
npm install
npm run dev          # http://localhost:5173
```

## Test

```sh
npm test             # Vitest: timing math, presets, settings
npm run typecheck
```

## Build

```sh
npm run build        # type-checks, then writes dist/ (app, service worker, manifest, icons)
npm run preview      # serves dist/ at http://localhost:4173
```

`npm run icons` regenerates the two PNG icons in `public/icons/` (Node built-ins only).

## Install on your phone

Service workers, the wake lock and home-screen install only work over HTTPS
(`localhost` is the one exception). So the phone has to open the app from an HTTPS address once.

**Easiest: GitHub Pages.** Put this folder at the root of its own public repository.
`.github/workflows/deploy.yml` builds and publishes the app on every push to `main`. One-time
setup: Settings → Pages → Source: GitHub Actions. The app is then at
`https://<user>.github.io/<repo>/`, and every later push updates the installed app by itself.

**Any other host:**

1. Run `npm run build` and upload the `dist/` folder to any static HTTPS host. All
   paths are relative, so a subfolder works too. Options include Netlify Drop (drag
   `dist/` onto app.netlify.com/drop), GitHub Pages, Cloudflare Pages, or your own server.
2. Open that URL on the phone with the network on. The service worker caches the app.
3. Add it to the home screen:
   - **iPhone (Safari):** Share → Add to Home Screen.
   - **Android (Chrome):** ⋮ menu → Install app (or Add to Home screen).
4. After that it works with the network off.

For a quick Android test without hosting, connect the phone by USB with USB debugging
on and run `npm run preview`. In desktop Chrome, open `chrome://inspect/#devices` →
Port forwarding, and map port `4173` to `localhost:4173`. Then open
`http://localhost:4173` on the phone. Chrome treats it as localhost, so everything works.

## iPhone: screen lock and audio

**iOS Safari suspends Web Audio when the screen locks or the app goes to the
background.** To prevent that, the app holds a Screen Wake Lock while a session runs.
It requests the lock on Start, releases it on Stop and Done, and requests it again whenever
the app returns to the foreground.

- The Screen Wake Lock API needs iOS 16.4 or later. Some iOS versions did not honor it
  in Home Screen apps, and battery-saver modes can refuse it. If the screen still locks
  during a session, set Settings → Display & Brightness → Auto-Lock to Never while you
  breathe, or keep the app in Safari.
- If audio is interrupted anyway (a call, Siri, pressing the side button, switching
  apps), the session pauses itself and shows Resume. Resume restarts the current phase
  with a beep.
- The app asks iOS 17 or later for the "playback" audio session, so the Ring/Silent switch does
  not mute it. On older iOS, turn the silent switch off.

## Change from the original spec

The rounds stepper runs 1–100 (the spec said 1–60) and there is a ~20 min quick preset,
because 20 minutes is the most-used length: 20:00 is 100 rounds at 3 s, 75 at 4 s and 60
at 5 s. The longest possible session is now 33:20 (100 rounds at 5 s).

The beeps are no longer identical, so you can find your place again if you lose track:

| Phase starting | Beep |
| --- | --- |
| Inhale | one high beep (784 Hz) |
| Hold (full) | two high beeps |
| Exhale | one low beep (523 Hz) |
| Hold (empty) | two low beeps |
| End of session | one mid beep (660 Hz, the original) |

High = lungs filling or full, low = emptying or empty; one beep = move, two = hold.
SPEC.md is updated to match both changes.

## Where the spec is silent

These are implementation choices, not spec changes. Each is easy to adjust.

| Situation | Behavior |
| --- | --- |
| Settle-in (first 6 s) | The phase label reads "Settle in" and counts down 6 → 1 to the first beep. The dot waits at the bottom-left corner. |
| Countdown and "left" time | Remaining time rounded up (4, 3, 2, 1). "left" counts to the final beep, not including the settle-in or fade-out. |
| Quick presets | ~2, ~5, ~10 and ~20 min snap to the nearest whole round; an exact half rounds up (at 4 s: ~2 min = 8 rounds / 2:08, ~10 min = 38 rounds / 10:08). ~20 min is exactly 20:00 at every phase length (100, 75 or 60 rounds). |
| Pause during the settle-in | Resume restarts the 6 s settle-in (no beep, as the settle-in never beeps). The fade-in keeps going while paused. |
| Beat ramp across a pause | The beat holds while paused. On Resume it returns to its value at the start of the restarted phase, so it still lands on the preset's end value exactly at the final beep. |
| Done | "Done" shows from the final beep for 3 s, then the app returns to Setup while the 8 s fade-out finishes in the background. Starting again during that tail is fine. The old tail keeps fading under the new fade-in. |
| Stop | Setup appears at once. Pending beeps are cancelled, and a beep already sounding (≤ 140 ms) finishes. The binaural ramps to silence over 1 s so it cannot click. |
| Volume sliders | Linear: binaural gain = 0.15 × slider, beep peak = 0.5 × slider. Volumes are set on Setup only, as the spec's session screen has no volume controls. |
| Beep scheduling | The spec's lookahead scheduler: a 250 ms timer keeps the next 2 s of beeps scheduled, and each beep starts at its exact audio-clock time. The spec also allows scheduling every beep at Start for sessions under ~20 min, but a 20:00 session at 3 s has 401 beeps, and the audio thread processes every waiting beep on every audio block. Rendering showed about 9× the work of the lookahead. |
| Time of day | Until you pick one, the default (Morning before 2 pm) is re-checked each time Setup is shown. A manual pick is saved and always wins. |
| Between sessions | The AudioContext is suspended once everything is silent, and the next Start resumes it. |
| Audio buffer | The AudioContext asks for the large "playback" buffer instead of the lowest-latency one, so a busy moment on the phone can't cause dropouts (heard as crackle or a burst of noise). Every beep and ramp is scheduled ahead, so this costs nothing in timing. |
| Screen timing | The countdown, label and dot follow the moment the sound reaches your ears (the audio clock corrected for output and Bluetooth delay with `getOutputTimestamp`), so they turn over with the beep you hear. |
| Moving dot | Its own GPU layer, moved with `transform` only: no repaint or blur filter per frame, so drawing the screen never competes with the audio. |

## Code layout

| Path | What it does |
| --- | --- |
| `src/session.ts` | Pure timing math: phase and seconds left at time t, totals, beep times, resume point, beat at any point in the ramp |
| `src/presets.ts` | Morning/Evening constants, ear frequencies, time-of-day default |
| `src/audio/engine.ts` | AudioContext, binaural voice, beeps, scheduling, fades, pause/resume/stop |
| `src/settings.ts` | localStorage persistence; every access in try/catch |
| `src/wakelock.ts` | Screen Wake Lock |
| `src/ui/` | Setup and Session views |
| `src/main.ts` | Wiring: Start, the animation-frame loop, Pause/Resume, Stop, interruptions |
| `tests/` | Vitest unit tests |
| `scripts/make-icons.mjs` | Icon generator |

Dependencies are dev-only: `vite`, `typescript`, `vite-plugin-pwa` and `vitest`. The built app has no runtime dependencies.
