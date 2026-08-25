/**
 * Attente BORNÉE des médias d'une slide — source unique partagée par le
 * planificateur (mesure du débordement) et l'export PDF. Les deux ont le même
 * besoin : ne jamais mesurer ni imprimer une image dont la taille naturelle
 * n'est pas encore connue, sans pour autant pouvoir attendre indéfiniment.
 */

/** Borne UNIQUE pour tout un lot de médias — jamais ce délai par média en série. */
export const PRESENTATION_MEDIA_TIMEOUT_MS = 3000;

/** Image prête : `complete && naturalWidth > 0`. Vidéo prête : métadonnées disponibles. */
export function isMediaReady(media: HTMLImageElement | HTMLVideoElement): boolean {
  if (media.tagName === "VIDEO") {
    const video = media as HTMLVideoElement;
    return (video.readyState ?? 0) >= 1 || (video.videoWidth > 0 && video.videoHeight > 0);
  }
  const img = media as HTMLImageElement;
  return img.complete && img.naturalWidth > 0;
}

/**
 * Source réellement chargeable du média. Un média SANS source ne déclenchera
 * jamais `load` : l'attendre reviendrait à attendre le délai complet pour
 * rien. Ce n'est pas un cas théorique — un embed non résolu (fichier
 * introuvable) produit exactement cela.
 */
function mediaSource(media: HTMLImageElement | HTMLVideoElement): string {
  const direct = typeof media.getAttribute === "function" ? media.getAttribute("src") ?? "" : "";
  return direct || media.currentSrc || "";
}

export function mediaElementsOf(root: HTMLElement): (HTMLImageElement | HTMLVideoElement)[] {
  return [...Array.from(root.querySelectorAll("img")), ...Array.from(root.querySelectorAll("video"))];
}

/** Médias qui ne sont pas encore dimensionnés ET qui peuvent encore se charger. */
export function pendingMediaOf(root: HTMLElement): (HTMLImageElement | HTMLVideoElement)[] {
  return mediaElementsOf(root).filter((media) => !isMediaReady(media) && mediaSource(media) !== "");
}

/**
 * Attente BORNÉE d'un LOT de médias — un seul délai global partagé par le lot
 * entier. Se résout dès que tous se sont résolus (load/error, ou
 * loadedmetadata/error pour une vidéo) OU dès que `timeoutMs` s'est écoulé,
 * au premier des deux.
 */
export function waitForMediaBatch(
  mediaEls: readonly (HTMLImageElement | HTMLVideoElement)[],
  timeoutMs: number = PRESENTATION_MEDIA_TIMEOUT_MS,
): Promise<void> {
  if (mediaEls.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let remaining = mediaEls.length;
    let settled = false;
    let timer: number | undefined;
    function finish(): void {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      resolve();
    }
    timer = window.setTimeout(finish, timeoutMs);
    function onSettledOne(): void {
      remaining -= 1;
      if (remaining <= 0) finish();
    }
    for (const media of mediaEls) {
      if (media.tagName === "VIDEO") {
        media.addEventListener("loadedmetadata", onSettledOne, { once: true });
      } else {
        media.addEventListener("load", onSettledOne, { once: true });
      }
      media.addEventListener("error", onSettledOne, { once: true });
    }
  });
}
