/** Libellé humain de la CIBLE d'une annotation — jamais son texte de
 * commentaire (`annotation.text`, inchangé). Dérivé UNIQUEMENT de
 * `annotation.quote` (le texte réellement ancré) : ne rejoue jamais
 * `resolveAnnotation` contre le Markdown source, ne modifie rien. Sert à
 * afficher, dans le panneau Notes de présentation, un texte lisible plutôt
 * que la syntaxe brute (`##`, `![[...]]`, `![...](...)`, `> [!type]`) —
 * jamais utilisé pour changer le contenu stocké. */
import { stripMarkdown } from "./core.js";

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const WIKI_IMAGE_RE = /^!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/;
const MD_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const CALLOUT_HEADER_RE = /^>\s*\[!([a-zA-Z][\w-]*)\][+-]?\s*(.*)$/;

function filenameOf(target: string): string {
  const clean = target.split("#")[0].trim();
  const parts = clean.split("/");
  return parts[parts.length - 1] || clean;
}

function humanizeCalloutType(type: string): string {
  return type.length ? type[0].toUpperCase() + type.slice(1).toLowerCase() : type;
}

/**
 * Ordre : 1. titre → texte sans marqueurs ; 2. image → alias/légende puis
 * nom de fichier ; 3. callout → titre du callout puis type lisible ;
 * 4. sélection ordinaire → extrait nettoyé (stripMarkdown, déjà utilisé
 * ailleurs dans ce plugin — voir utils/core.ts).
 */
export function humanAnnotationTargetLabel(annotation: { quote: string }): string {
  const quote = (annotation.quote ?? "").trim();
  if (!quote) return "";

  const heading = HEADING_RE.exec(quote);
  if (heading) return heading[2].trim();

  const wikiImage = WIKI_IMAGE_RE.exec(quote);
  if (wikiImage) {
    const [, target, alias] = wikiImage;
    return (alias && alias.trim()) || filenameOf(target);
  }

  const mdImage = MD_IMAGE_RE.exec(quote);
  if (mdImage) {
    const [, alt, target] = mdImage;
    return (alt && alt.trim()) || filenameOf(target);
  }

  if (quote.startsWith(">")) {
    const firstLine = quote.split("\n")[0].trim();
    const callout = CALLOUT_HEADER_RE.exec(firstLine);
    if (callout) {
      const [, calloutType, title] = callout;
      return (title && title.trim()) || humanizeCalloutType(calloutType);
    }
  }

  return stripMarkdown(quote).trim() || quote;
}
