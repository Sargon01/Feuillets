import type { ButtonComponent, Notice } from "obsidian";

/* Ponts de compatibilité entre deux générations d'API Obsidian.
 *
 * Obsidian remplace régulièrement une API par une autre, mais la remplaçante
 * n'apparaît qu'à partir d'une version donnée — souvent postérieure au
 * `minAppVersion` du greffon (1.7.2). Les typages livrés décrivent la seule
 * version courante et ne peuvent donc pas exprimer « l'un ou l'autre selon
 * l'hôte » : suivre la recommandation à la lettre casserait le greffon sur
 * les versions basses, l'ignorer priverait les versions hautes de l'API
 * moderne.
 *
 * Ces aides interrogent l'objet à l'exécution et retiennent la forme moderne
 * dès que l'hôte la fournit, avec repli sur l'ancienne sinon. Les types
 * locaux ci-dessous ne masquent aucune dépréciation : ils décrivent la forme
 * réellement observable sur l'ensemble de la plage supportée, ce que la
 * déclaration officielle ne dit pas. Il n'y a donc ni `any`, ni assertion,
 * ni règle désactivée.
 *
 * À supprimer le jour où `minAppVersion` dépassera la version indiquée pour
 * chaque pont.
 */

/** Forme d'une `Notice` sur la plage supportée : `noticeEl` est présent
 * partout (déprécié depuis 1.8.7, jamais retiré), `messageEl` seulement à
 * partir de 1.8.7. `containerEl` n'est pas utilisable comme repli : il est
 * lui aussi apparu en 1.8.7. */
type NoticeContent = {
  messageEl?: HTMLElement;
  noticeEl: HTMLElement;
};

/** Élément portant le texte d'une `Notice`, sur lequel accrocher classes et
 * écouteurs. Rend `messageEl` (Obsidian 1.8.7+) quand il existe, sinon
 * `noticeEl`. */
export function noticeMessageEl(notice: Notice): HTMLElement {
  const content: NoticeContent = notice;
  return content.messageEl ?? content.noticeEl;
}

/** Formes du style « action destructive » sur un `ButtonComponent` :
 * `setWarning()` jusqu'à 1.12.x, `setDestructive()` à partir de 1.13.0. Les
 * deux sont optionnelles ici parce qu'aucune n'est garantie sur toute la
 * plage — `setDestructive` manque en bas, `setWarning` peut disparaître en
 * haut le jour où la dépréciation ira à son terme. */
type DestructiveStyling = {
  setDestructive?: () => ButtonComponent;
  setWarning?: () => ButtonComponent;
};

/** Marque un bouton comme action destructive (rouge). Utilise
 * `setDestructive()` (Obsidian 1.13.0+) quand il existe, sinon
 * `setWarning()`. Si aucune n'est disponible, le bouton reste fonctionnel
 * avec son style par défaut : le rendu est dégradé, jamais cassé. */
export function setButtonDestructive(button: ButtonComponent): ButtonComponent {
  const styling: DestructiveStyling = button;
  if (typeof styling.setDestructive === "function") return styling.setDestructive();
  if (typeof styling.setWarning === "function") return styling.setWarning();
  return button;
}
