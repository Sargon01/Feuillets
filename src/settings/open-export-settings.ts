/** Identifiant stable de l'onglet de réglages fourni par le manifeste. */
export const FEUILLETS_SETTINGS_TAB_ID = "feuillets";

type SettingsModal = {
  open?(): void;
  openTabById(id: string): void;
  activeTab?: unknown;
};

/** Ouvre le centre de configuration unique et sélectionne sa rubrique
 * Export. Cette petite façade ne dépend pas du composant de rendu des
 * réglages : PreviewView ne charge donc ni panneau ni modal concurrents. */
export function openFeuilletsExportSettings(app: unknown): void {
  const setting = (app as { setting?: SettingsModal }).setting;
  if (!setting?.openTabById) return;
  setting.open?.();
  setting.openTabById(FEUILLETS_SETTINGS_TAB_ID);
  const tab = setting.activeTab as { _activeSettingsTab?: string; refreshForExternalCallers?: () => void } | undefined;
  if (!tab || !("_activeSettingsTab" in tab)) return;
  tab._activeSettingsTab = "Export";
  tab.refreshForExternalCallers?.();
}
