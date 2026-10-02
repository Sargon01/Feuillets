import type { TextAnalysisProvider } from "../api/text-analysis.js";

export const LIVE_TEXT_ANALYSIS_DEBOUNCE_MS = 1000;

export type LiveTextAnalysisSnapshot = {
  filePath: string;
  fileTitle: string;
  text: string;
  provider: TextAnalysisProvider;
  context: unknown;
};

type TimerHost = {
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

type LiveTextAnalysisOptions<Result> = {
  analyze: (snapshot: LiveTextAnalysisSnapshot) => Promise<Result>;
  isCurrent: (snapshot: LiveTextAnalysisSnapshot) => boolean;
  publish: (result: Result, snapshot: LiveTextAnalysisSnapshot) => void;
  reportError?: (error: Error) => void;
  onRunningChange?: (running: boolean) => void;
  debounceMs?: number;
  timers?: TimerHost;
};

function sameSnapshot(a: LiveTextAnalysisSnapshot, b: LiveTextAnalysisSnapshot): boolean {
  return a.filePath === b.filePath && a.text === b.text && a.provider === b.provider && a.context === b.context;
}

/** Regroupe les changements d'un texte vivant et ne publie qu'un résultat
 * encore associé au même contexte. Les fournisseurs ne proposant pas
 * d'annulation, une exécution obsolète est simplement ignorée à son retour. */
export class LiveTextAnalysis<Result> {
  private readonly debounceMs: number;
  private readonly timers: TimerHost;
  private timer: unknown | null = null;
  private pending: LiveTextAnalysisSnapshot | null = null;
  private active: LiveTextAnalysisSnapshot | null = null;
  private accepted: LiveTextAnalysisSnapshot | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly options: LiveTextAnalysisOptions<Result>) {
    this.debounceMs = options.debounceMs ?? LIVE_TEXT_ANALYSIS_DEBOUNCE_MS;
    this.timers = options.timers ?? window;
  }

  schedule(snapshot: LiveTextAnalysisSnapshot): void {
    if (this.disposed || !this.options.isCurrent(snapshot)) return;
    if (this.accepted && sameSnapshot(this.accepted, snapshot)) return;
    if (this.active && sameSnapshot(this.active, snapshot)) return;
    if (this.pending && sameSnapshot(this.pending, snapshot)) return;

    this.generation += 1;
    this.pending = snapshot;
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.startPending();
    }, this.debounceMs);
  }

  invalidate(): void {
    this.generation += 1;
    this.pending = null;
    this.accepted = null;
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }

  private startPending(): void {
    if (this.disposed || this.active || !this.pending) return;
    const snapshot = this.pending;
    this.pending = null;
    if (!this.options.isCurrent(snapshot)) return;

    const generation = this.generation;
    this.active = snapshot;
    this.options.onRunningChange?.(true);
    void Promise.resolve()
      .then(() => this.options.analyze(snapshot))
      .then((result) => {
        if (!this.disposed && generation === this.generation && this.options.isCurrent(snapshot)) {
          this.accepted = snapshot;
          this.options.publish(result, snapshot);
        }
      })
      .catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.options.reportError?.(normalized);
      })
      .finally(() => {
        this.active = null;
        this.options.onRunningChange?.(false);
        if (this.pending && this.timer === null) this.startPending();
      });
  }
}
