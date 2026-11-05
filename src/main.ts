import './styles.css';
import { AudioEngine, type SessionPlayer } from './audio/engine';
import { PRESETS } from './presets';
import { DONE_SECONDS, viewAt } from './session';
import { loadSettings, saveSettings } from './settings';
import { SessionScreen } from './ui/session-view';
import { SetupView } from './ui/setup';
import { ScreenWakeLock } from './wakelock';

const engine = new AudioEngine();
const wakeLock = new ScreenWakeLock();
const sessionScreen = new SessionScreen();
const setup = new SetupView(loadSettings(), saveSettings, start);

let player: SessionPlayer | null = null;
let frame = 0;

function start(): void {
  // Still inside the Start tap: browsers only let audio start from a user gesture.
  void engine.unlock();
  wakeLock.acquire();
  const s = setup.current;
  player = engine.startSession({
    preset: PRESETS[setup.timeOfDay()],
    phaseSeconds: s.phaseSeconds,
    rounds: s.rounds,
    binauralVolume: s.binauralVolume / 100,
    beepVolume: s.beepVolume / 100,
  });
  setup.hide();
  sessionScreen.show();
  tick();
}

/** Draw the session screen from the audio clock. The UI reads the clock; it never owns it. */
function render(p: SessionPlayer): { t: number; done: boolean } {
  const t = p.time(engine.heardTime());
  const view = viewAt(t, p.plan.phaseSeconds, p.plan.rounds);
  sessionScreen.render(view, p.paused);
  return { t, done: view.stage === 'done' };
}

function tick(): void {
  frame = 0;
  const p = player;
  if (!p) return;
  const { t, done } = render(p);
  if (done) {
    wakeLock.release();
    if (t >= p.finalTime + DONE_SECONDS) {
      showSetup();
      return;
    }
  }
  frame = requestAnimationFrame(tick);
}

function showSetup(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  player = null;
  wakeLock.release();
  sessionScreen.hide();
  setup.show();
}

sessionScreen.pauseButton.addEventListener('click', () => {
  const p = player;
  if (!p) return;
  if (p.paused) {
    // Resume the AudioContext inside the tap in case the browser suspended it,
    // and only restart the phase once audio is really running again.
    void engine.unlock().then(() => {
      if (player === p && engine.state === 'running' && p.resume()) render(p);
    });
  } else if (p.pause()) {
    render(p);
  }
});

sessionScreen.stopButton.addEventListener('click', () => {
  player?.stop();
  showSetup();
});

// A call, Siri, a screen lock or backgrounding suspended the audio: pause and offer Resume.
engine.onInterrupted = () => {
  if (player?.pause()) render(player);
};
