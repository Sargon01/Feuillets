import type { App } from "obsidian";
import { buildFeuilProjectExportPlan } from "./feuil-project-export.js";
import { createFeuilProjectPackage } from "./feuil-project-package.js";
import type { FeuilProjectManifest } from "./feuil-project-package.js";

export type FeuilProjectArchiveOptions = {
  createdByVersion: string;
  packageId: string;
  createdAt: string;
};

export type FeuilProjectArchive = {
  data: Uint8Array;
  manifest: FeuilProjectManifest;
};

export async function buildFeuilProjectArchive(
  app: App,
  settings: FeuilletsSettings,
  options: FeuilProjectArchiveOptions,
): Promise<FeuilProjectArchive> {
  const plan = await buildFeuilProjectExportPlan(
    app,
    settings,
    options.createdByVersion,
    options.packageId,
    options.createdAt,
  );
  const data = await createFeuilProjectPackage(plan.manifest, plan.files, plan.directories);
  return { data, manifest: plan.manifest };
}
