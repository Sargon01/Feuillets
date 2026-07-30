/** Extraction XML générique à profondeur suivie — aucune regex non gourmande
 * naïve sur un tag qui peut s'imbriquer en lui-même (ex. <Item><Item>…). Née
 * pour l'import Scrivener (.scrivx), réutilisée telle quelle pour lire le XML
 * OOXML d'un .docx (services/docx-import.js) : les noms de tag préfixés
 * (ex. "w:ins") passent tels quels, aucune caractère spécial à échapper.
 *
 * Contient aussi l'échappement dans l'autre sens, pour les formats que le
 * plugin ÉCRIT (EPUB, ODT). */

type OpenTag = {
  index: number;
  endIndex: number;
  attrs: string;
  selfClosing: boolean;
};

type MatchingClose = {
  bodyEnd: number;
  afterEnd: number;
};

/** Échappe un texte destiné à du contenu XML ou à une valeur d'attribut entre
 * guillemets doubles.
 *
 * `'` n'est volontairement pas échappé : il n'aurait besoin de l'être que dans
 * un attribut délimité par des apostrophes, ce que ni l'EPUB ni l'ODT
 * n'écrivent — et l'apostrophe est trop fréquente en français pour l'alourdir
 * en `&apos;` dans tout le corps du manuscrit.
 *
 * L'ordre compte : `&` d'abord, sinon les `&` des entités produites ensuite
 * seraient rééchappés en `&amp;lt;`.
 */
export function escapeXml(s: unknown): string {
  if (s === null || s === undefined) return "";
  const text = typeof s === "string" ? s : typeof s === "number" || typeof s === "boolean" || typeof s === "bigint" ? String(s) : "";
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function findOpenTag(xml: string, tag: string, fromIndex: number): OpenTag | null {
  const re = new RegExp(`<${tag}(?=[\\s/>])([^>]*)>`, "gi");
  re.lastIndex = fromIndex;
  const m = re.exec(xml);
  if (!m) return null;
  const rawAttrs = m[1];
  const selfClosing = /\/\s*$/.test(rawAttrs);
  return {
    index: m.index,
    endIndex: m.index + m[0].length,
    attrs: selfClosing ? rawAttrs.replace(/\/\s*$/, "") : rawAttrs,
    selfClosing,
  };
}

/** Trouve la fermeture correspondant à l'ouverture qui se termine à
 * `fromIndex`, en comptant la profondeur des ouvertures/fermetures du même
 * tag rencontrées entre-temps — indispensable pour un tag qui s'imbrique en
 * lui-même (BinderItem/Children côté Scrivener, w:p côté OOXML). */
function findMatchingClose(xml: string, tag: string, fromIndex: number): MatchingClose | null {
  const re = new RegExp(`</?${tag}(?=[\\s/>])(?:[^>]*)>`, "gi");
  re.lastIndex = fromIndex;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const isClose = m[0][1] === "/";
    const selfClosing = !isClose && /\/\s*>$/.test(m[0]);
    if (isClose) {
      depth--;
      if (depth === 0) return { bodyEnd: m.index, afterEnd: m.index + m[0].length };
    } else if (!selfClosing) {
      depth++;
    }
  }
  return null; // XML malformé ou tronqué — laissé sans contenu plutôt que de planter
}

/** Contenu du premier tag `<tag>…</tag>` rencontré, profondeur suivie. */
export function extractTag(xml: string | null | undefined, tag: string): string {
  if (!xml) return "";
  const open = findOpenTag(xml, tag, 0);
  if (!open || open.selfClosing) return "";
  const close = findMatchingClose(xml, tag, open.endIndex);
  if (!close) return "";
  return xml.slice(open.endIndex, close.bodyEnd).trim();
}

/** Tous les tags `<tag>` de premier niveau dans `xml` (pas les tags du même
 * nom imbriqués à l'intérieur d'un autre `tag` — ceux-là font partie de son
 * `body` et sont extraits par un appel récursif dessus). */
export function extractAllTags(xml: string | null | undefined, tag: string): Array<{ attrs: string; body: string }> {
  const results: Array<{ attrs: string; body: string }> = [];
  if (!xml) return results;
  let cursor = 0;
  for (;;) {
    const open = findOpenTag(xml, tag, cursor);
    if (!open) break;
    if (open.selfClosing) {
      results.push({ attrs: open.attrs, body: "" });
      cursor = open.endIndex;
      continue;
    }
    const close = findMatchingClose(xml, tag, open.endIndex);
    if (!close) break;
    results.push({ attrs: open.attrs, body: xml.slice(open.endIndex, close.bodyEnd) });
    cursor = close.afterEnd;
  }
  return results;
}

export function getAttr(attrs: string | null | undefined, name: string): string {
  if (!attrs) return "";
  const m = new RegExp(`${name}="([^"]*)"`, "i").exec(attrs);
  return m ? decodeXmlEntities(m[1]) : "";
}

export function decodeXmlEntities(str: unknown): string {
  if (str === null || str === undefined) return "";
  const text = typeof str === "string" ? str : typeof str === "number" || typeof str === "boolean" || typeof str === "bigint" ? String(str) : "";
  if (!text) return "";
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    /* fromCodePoint et non fromCharCode : ce dernier est limité au plan
       multilingue de base (U+FFFF) et renvoie un caractère faux au-delà —
       une émoji (`&#x1F600;`) devenait un caractère de remplacement. Cas
       réel : les commentaires d'un directeur littéraire dans un .docx
       relu (voir services/docx-review-import.js). */
    .replace(/&#x([0-9a-fA-F]+);/g, (_match: string, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_match: string, d: string) => codePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&"); // toujours en dernier
}

/** Caractère d'un point de code, ou l'entité laissée telle quelle si le
 * nombre est hors des bornes Unicode — mieux vaut une entité visible qu'une
 * exception qui ferait échouer toute la lecture du document.
 * @param {number} n
 * @returns {string}
 */
function codePoint(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 0x10ffff) return "�";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "�";
  }
}

/** Marche séquentiellement dans `xml`, tag par tag (peu importe le nom),
 * profondeur suivie — pour un parcours en ordre de document (ex. reconnaître
 * un signet de scène en cours de route pendant qu'on traverse les paragraphes
 * d'un .docx), plutôt que de chercher un tag précis à la fois. Chaque pas
 * renvoie soit un élément vide `<tag .../>`, soit un élément ouvrant/fermant
 * `<tag ...>`/`</tag>` — au consommateur de suivre lui-même la pile. */
export function walkTags(xml: string | null | undefined): Array<{
  name: string;
  attrs: string;
  selfClosing: boolean;
  isClose: boolean;
  index: number;
  endIndex: number;
}> {
  const results: Array<{
    name: string;
    attrs: string;
    selfClosing: boolean;
    isClose: boolean;
    index: number;
    endIndex: number;
  }> = [];
  if (!xml) return results;
  const re = /<\/?([a-zA-Z0-9:_-]+)((?:\s+[^>]*?)?)\s*(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const isClose = m[0][1] === "/";
    results.push({
      name: m[1],
      attrs: m[2] || "",
      selfClosing: !!m[3],
      isClose,
      index: m.index,
      endIndex: m.index + m[0].length,
    });
  }
  return results;
}
