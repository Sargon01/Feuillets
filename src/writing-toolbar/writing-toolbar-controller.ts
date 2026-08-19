import type { WritingActionRegistry } from "./writing-action-registry.js";
import type { WritingContext } from "./writing-context.js";
import {
  WritingToolbar,
  type WritingToolbarMode,
  type WritingToolbarOverride,
  type WritingToolbarPosition,
} from "./writing-toolbar.js";

/** Contrôleur de la Barre d'écriture : possède le registre, la barre courante,
 *  le contexte courant et l'override de session (non persistant, survive au
 *  changement de feuillet). Changer de MODE (Settings) réinitialise l'override ;
 *  changer uniquement la position ne le fait pas. */
export class WritingToolbarController {
  readonly registry: WritingActionRegistry;
  /** Barre montée actuellement (null si pas de contexte / mode désactivé). */
  toolbar: WritingToolbar | null = null;
  /** Contexte résolu lors du dernier sync(). */
  context: WritingContext | null = null;
  /** Override de session : "show" | "hide" | null. */
  override: WritingToolbarOverride = null;

  private lastMode: WritingToolbarMode | null = null;

  constructor(registry: WritingActionRegistry) {
    this.registry = registry;
  }

  /** Réconcilie contexte + réglages avec la barre montée. Détruit l'ancienne
   *  barre si le host change, réutilise la même si identical, ne monte rien
   *  si context === null ou mode === "disabled". */
  sync(context: WritingContext | null, mode: WritingToolbarMode, position: WritingToolbarPosition): void {
    if (mode !== this.lastMode) {
      this.override = null;
      this.lastMode = mode;
    }
    this.context = context;

    if (context === null || mode === "disabled") {
      this.unmount();
      return;
    }

    const current = this.toolbar;
    if (current) {
      if (current.hostEl === context.hostEl) {
        current.setPosition(position);
        current.setMode(mode);
        current.setOverride(this.override);
        return;
      }
      this.unmount();
    }

    this.toolbar = new WritingToolbar({
      context,
      registry: this.registry,
      position,
      mode,
    });
    this.toolbar.setOverride(this.override);
  }

  /** Re-applique mode/position à l'état courant (settings) sans changer de
   *  contexte. Un changement de mode réinitialise l'override (via sync). */
  refresh(mode: WritingToolbarMode, position: WritingToolbarPosition): void {
    this.sync(this.context, mode, position);
  }

  /** Commande Afficher/masquer : bascule l'override de session. No-op strict en
   *  mode disabled. always : null → hide → show → hide… ; shortcut/hover :
   *  null → show → hide… */
  toggleSessionVisibility(): void {
    if (this.lastMode === "disabled") return;

    if (this.override === "show") {
      this.override = "hide";
    } else if (this.override === "hide") {
      this.override = "show";
    } else if (this.lastMode === "always") {
      this.override = "hide";
    } else {
      this.override = "show";
    }
    if (this.toolbar) this.toolbar.setOverride(this.override);
  }

  destroy(): void {
    this.unmount();
    this.context = null;
  }

  private unmount(): void {
    if (this.toolbar) {
      this.toolbar.destroy();
      this.toolbar = null;
    }
  }
}