import type { TextAnalysisProvider, LinguisticAnalysisResult, LinguisticVocabEntry } from "../api/text-analysis.js";
import { formatNumber } from "../utils/text-metrics.js";
import { t } from "../i18n/index.js";

export type ToolRenderer = (
  parent: HTMLElement,
  key: string,
  icon: string,
  title: string,
  renderBody: (section: HTMLElement) => void
) => void;

/** Rend la section d'analyse linguistique dans le panneau Analyse.
 *  Feuillets principal ne fait AUCUN calcul morphologique : il demande
 *  simplement `provider.analyzeLinguistics({ text })` si le fournisseur actif le
 *  supporte. */
export function renderLinguisticAnalysisSection(
  container: HTMLElement,
  key: string,
  title: string,
  provider: TextAnalysisProvider | null,
  tool: ToolRenderer,
  getText: () => Promise<string>
): void {
  tool(container, key, "book-marked", title, (section) => {
    const body = section.createDiv({ cls: "feuillets-analysis-body" });

    if (!provider || typeof provider.analyzeLinguistics !== "function") {
      body
        .createDiv({ cls: "feuillets-empty" })
        .setText(t("analysis.vocab.noLinguisticProvider"));
      return;
    }

    body.createDiv({ cls: "feuillets-analysis-summary" }).setText(t("analysisResults.running"));

    void (async () => {
      try {
        const text = await getText();
        const result = await provider.analyzeLinguistics!({ text });
        body.empty();

        if (!result) {
          body.createDiv({ cls: "feuillets-empty" }).setText(t("analysis.vocab.unavailable"));
          return;
        }

        renderLinguisticResult(body, result);
      } catch {
        body.empty();
        body.createDiv({ cls: "feuillets-empty" }).setText(t("analysis.vocab.unavailable"));
      }
    })();
  });
}

function renderLinguisticResult(container: HTMLElement, vocab: LinguisticAnalysisResult): void {
  if (vocab.richness !== undefined && vocab.uniqueLemmas !== undefined && vocab.contentTotal !== undefined) {
    container.createDiv({ cls: "feuillets-analysis-summary" }).setText(
      t("analysis.vocab.summary", {
        richness: String(Math.round(vocab.richness * 100)),
        lemmas: formatNumber(vocab.uniqueLemmas),
        content: formatNumber(vocab.contentTotal),
        hapax: formatNumber(vocab.hapaxCount ?? 0),
      })
    );
  }

  const group = (label: string, entries?: LinguisticVocabEntry[]) => {
    if (!entries) return;
    container.createDiv({ cls: "feuillets-analysis-summary feuillets-vocab-group" }).setText(label);
    const list = container.createDiv({ cls: "feuillets-notes-metadata-list" });
    if (!entries.length) {
      list.createDiv({ cls: "feuillets-empty" }).setText("—");
      return;
    }
    for (const [lemma, n] of entries) {
      const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
      row.createDiv({ cls: "feuillets-notes-metadata-label", text: lemma });
      row.createDiv({ cls: "feuillets-notes-metadata-value", text: `×${n}` });
    }
  };

  group(t("analysis.vocab.favoriteVerbs"), vocab.favoriteVerbs);

  if (vocab.weakVerbs && vocab.weakTotal !== undefined && vocab.weakPct !== undefined) {
    group(
      t("analysis.vocab.weakVerbs", { total: formatNumber(vocab.weakTotal), pct: String(vocab.weakPct) }) +
        (vocab.weakPct >= 40 ? t("analysis.vocab.toVary") : ""),
      vocab.weakVerbs
    );
  }

  group(t("analysis.vocab.favoriteAdjs"), vocab.favoriteAdjs);
  group(t("analysis.vocab.favoriteAdvs"), vocab.favoriteAdvs);

  if (vocab.mentAdverbs && vocab.mentTotal !== undefined && vocab.mentPct !== undefined) {
    group(
      t("analysis.vocab.mentAdverbs", { total: formatNumber(vocab.mentTotal), pct: String(vocab.mentPct) }) +
        (vocab.mentPct >= 3 ? t("analysis.vocab.toWatch") : ""),
      vocab.mentAdverbs
    );
  }

  if (vocab.passiveCount !== undefined) {
    container.createDiv({ cls: "feuillets-analysis-summary" }).setText(
      t("analysis.vocab.passiveVoice", { count: formatNumber(vocab.passiveCount) })
    );
  }

  if (vocab.grammaticalCategories) {
    const list = container.createDiv({ cls: "feuillets-notes-metadata-list feuillets-mt-xs" });
    for (const [cat, count] of Object.entries(vocab.grammaticalCategories)) {
      if (count <= 0) continue;
      const row = list.createDiv({ cls: "feuillets-notes-metadata-row" });
      row.createDiv({ cls: "feuillets-notes-metadata-label", text: cat });
      row.createDiv({ cls: "feuillets-notes-metadata-value", text: formatNumber(count) });
    }
  }
}
