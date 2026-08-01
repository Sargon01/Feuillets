/* Feuillets Grammalecte — greffon compagnon.
 *
 * Tout ce qu'il fait : enregistrer un fournisseur d'analyse auprès de
 * Feuillets, et le retirer proprement au déchargement. Il n'a ni vue, ni
 * commande d'analyse, ni navigation vers les erreurs : Feuillets fournit
 * déjà tout cela de façon générique (onglet Relecture, commandes « Analyser
 * le document courant » / « Analyser la sélection »). Les dupliquer ne
 * ferait qu'ajouter des entrées concurrentes dans la palette. */

import { Notice, Plugin } from "obsidian";
import { getFeuilletsApi, isFeuilletsPresentWithoutApi } from "./src/feuillets-api.ts";
import { GrammalecteProvider, PROVIDER_ID } from "./src/grammalecte-provider.ts";
import {
  DEFAULT_SETTINGS,
  GrammalecteSettingTab,
  normalizeSettings,
  type GrammalecteSettings,
} from "./src/settings.ts";

export default class FeuilletsGrammalectePlugin extends Plugin {
  /* `Plugin.settings?: unknown` n'existe dans obsidian.d.ts que depuis
     1.13.0 ("Assign loaded data here in onload. Declare a concrete type on
     your subclass to type it.") — mais c'est une annotation de TYPE, pas un
     comportement d'exécution : aucune méthode de `Plugin` ne lit ni n'écrit
     ce champ, avant ou après 1.13.0. Le déclarer et l'assigner soi-même dans
     `onload()` (ce que fait exactement le commentaire ci-dessus) fonctionne
     identiquement sur toutes les versions — c'est la convention Obsidian la
     plus ancienne et la plus répandue, désormais simplement typée. Une revue
     obsidianmd le signale malgré tout (`no-unsupported-api`, en comparant le
     type au `@since`) : faux positif assumé, minAppVersion (1.7.2) reste
     inchangé plutôt que d'être relevé pour un non-problème. */
  settings: GrammalecteSettings = { ...DEFAULT_SETTINGS };

  private provider: GrammalecteProvider | null = null;
  private connected = false;
  private unloaded = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new GrammalecteSettingTab(this.app, this));

    /* Feuillets chargé APRÈS nous : au moment de notre onload(), son API
       n'existe pas encore. On retente donc une fois la disposition prête,
       moment où tous les greffons activés au démarrage sont chargés. */
    if (!this.connect()) {
      this.app.workspace.onLayoutReady(() => {
        if (this.unloaded) return;
        if (!this.connect()) this.warnMissingFeuillets();
      });
    }

    /* Feuillets rechargé APRÈS nous (désactivation/réactivation depuis les
       préférences) : son registre repart vide et notre fournisseur est perdu.
       Obsidian n'expose aucun évènement pour le détecter — d'où cette seule
       commande, qui n'a pas d'équivalent côté Feuillets. */
    this.addCommand({
      id: "reconnect",
      name: "Reconnecter le correcteur",
      callback: () => {
        if (this.connect()) new Notice("Grammalecte est de nouveau enregistré auprès de Feuillets.");
        else this.warnMissingFeuillets();
      },
    });
  }

  onunload(): void {
    this.unloaded = true;
    /* Se retirer AVANT de libérer le moteur : Feuillets ne doit à aucun
       moment détenir une référence vers un fournisseur démonté. */
    getFeuilletsApi(this.app)?.unregisterAnalysisProvider(PROVIDER_ID);
    this.provider?.dispose();
    this.provider = null;
    this.connected = false;
  }

  /** Enregistre le fournisseur si Feuillets est là. Idempotent : le registre
   *  de Feuillets remplace une entrée de même identifiant. */
  connect(): boolean {
    const api = getFeuilletsApi(this.app);
    if (!api) return false;

    this.provider ??= new GrammalecteProvider(() => this.settings, () => this.saveSettings());
    api.registerAnalysisProvider(this.provider);
    this.connected = true;
    return true;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  private warnMissingFeuillets(): void {
    const message = isFeuilletsPresentWithoutApi(this.app)
      ? "Feuillets Grammalecte : cette version de Feuillets n'expose pas encore l'API d'analyse. Mettez Feuillets à jour."
      : "Feuillets Grammalecte : le greffon Feuillets doit être installé et activé.";
    console.warn(message);
    new Notice(message);
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
