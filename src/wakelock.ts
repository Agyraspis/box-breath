/**
 * Screen Wake Lock: keeps the screen on during a session, because iOS Safari
 * suspends Web Audio when the screen locks. The browser drops the lock whenever
 * the page is hidden, so it is requested again when the page becomes visible.
 */
export class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private requesting = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') void this.request();
    });
  }

  static get supported(): boolean {
    return 'wakeLock' in navigator;
  }

  acquire(): void {
    this.wanted = true;
    void this.request();
  }

  release(): void {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    sentinel?.release().catch(() => undefined);
  }

  private async request(): Promise<void> {
    if (!ScreenWakeLock.supported || this.sentinel || this.requesting) return;
    if (document.visibilityState !== 'visible') return;
    this.requesting = true;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      if (!this.wanted) {
        await sentinel.release();
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
    } catch {
      // Refused (battery saver, permissions policy) or unsupported: the session still runs.
    } finally {
      this.requesting = false;
    }
  }
}
