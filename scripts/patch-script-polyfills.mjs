import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// jszip and docx both bundle a copy of the classic "setImmediate" polyfill
// (IE6-8 compatibility, ~2013-era code). One of its fallback branches
// schedules a task by creating an empty <script> element and listening for
// its `onreadystatechange` event — it never sets `src`, never loads or runs
// any external/arbitrary code, and this branch is dead code in Electron
// anyway (an earlier branch in the same chain already picks Node's
// setImmediate / a MutationObserver, both always available here). Harmless
// in practice, but its literal presence trips static "dynamic <script>
// injection" security scanners (e.g. Obsidian's plugin review) that can't
// tell dead legacy code from a real risk. Patched out after npm install
// rather than left for reviewers to re-litigate on every submission.
//
// jszip's package.json "browser" field actually points our `import "jszip"`
// at dist/jszip.min.js, not dist/jszip.js — both are patched (jszip.js for
// defense-in-depth in case resolution ever changes, jszip.min.js because
// it's the one that's really bundled). docx also ships index.cjs/
// index.umd.cjs/index.iife.js with the same pattern, but esbuild never
// bundles those for our ESM import.

function patchFile(relPath, replacements, label) {
  const target = fileURLToPath(new URL(relPath, import.meta.url));
  let content;
  try {
    content = readFileSync(target, "utf8");
  } catch (e) {
    console.warn(`patch-script-polyfills: ${label} introuvable (${e.message}) — ignoré.`);
    return;
  }

  let changed = false;
  for (const { before, after } of replacements) {
    // "before" d'abord, jamais l'inverse : "after" est parfois une sous-chaîne
    // littérale de "before" (la fin de l'expression est gardée telle quelle),
    // donc vérifier "after" en premier donnerait un faux "déjà appliqué" sur
    // le fichier vierge et laisserait le motif d'origine intact.
    if (content.includes(before)) {
      content = content.replace(before, after);
      changed = true;
    } else if (!content.includes(after)) {
      console.warn(`patch-script-polyfills: motif attendu introuvable dans ${label} — version différente ? à vérifier manuellement.`);
    }
  }
  if (changed) {
    writeFileSync(target, content);
    console.log(`patch-script-polyfills: ${label} corrigé.`);
  } else {
    console.log(`patch-script-polyfills: ${label} déjà à jour.`);
  }
}

patchFile("../node_modules/jszip/dist/jszip.js", [
  {
    before: `    function installReadyStateChangeImplementation() {
        var html = doc.documentElement;
        registerImmediate = function(handle) {
            // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
            // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
            var script = doc.createElement("script");
            script.onreadystatechange = function () {
                runIfPresent(handle);
                script.onreadystatechange = null;
                html.removeChild(script);
                script = null;
            };
            html.appendChild(script);
        };
    }`,
    after: `    function installReadyStateChangeImplementation() {
        // Patched by Feuillets (scripts/patch-script-polyfills.mjs) — see file header.
        installSetTimeoutImplementation();
    }`,
  },
  {
    before: `} else if (doc && "onreadystatechange" in doc.createElement("script")) {
        // For IE 6–8
        installReadyStateChangeImplementation();`,
    after: `} else if (false) {
        // Patched by Feuillets (scripts/patch-script-polyfills.mjs) — see file header.
        installReadyStateChangeImplementation();`,
  },
], "jszip/dist/jszip.js");

patchFile("../node_modules/jszip/dist/jszip.min.js", [
  {
    before: `"onreadystatechange"in t.document.createElement("script")?function(){var e=t.document.createElement("script");e.onreadystatechange=function(){u(),e.onreadystatechange=null,e.parentNode.removeChild(e),e=null},t.document.documentElement.appendChild(e)}:function(){setTimeout(u,0)}`,
    after: `false?function(){}:function(){setTimeout(u,0)}`,
  },
  {
    before: `l&&"onreadystatechange"in l.createElement("script")?(s=l.documentElement,function(e){var t=l.createElement("script");t.onreadystatechange=function(){c(e),t.onreadystatechange=null,s.removeChild(t),t=null},s.appendChild(t)}):function(e){setTimeout(c,0,e)}`,
    after: `function(e){setTimeout(c,0,e)}`,
  },
], "jszip/dist/jszip.min.js");

patchFile("../node_modules/docx/dist/index.mjs", [
  {
    before: `} else if (t.setImmediate || void 0 === t.MessageChannel) r = "document" in t && "onreadystatechange" in t.document.createElement("script") ? function() {
						var e = t.document.createElement("script");
						e.onreadystatechange = function() {
							u(), e.onreadystatechange = null, e.parentNode.removeChild(e), e = null;
						}, t.document.documentElement.appendChild(e);
					} : function() {
						setTimeout(u, 0);
					};`,
    after: `} else if (t.setImmediate || void 0 === t.MessageChannel) r = function() {
						setTimeout(u, 0);
					};`,
  },
  {
    before: `}) : l && "onreadystatechange" in l.createElement("script") ? (s = l.documentElement, function(e) {
								var t = l.createElement("script");
								t.onreadystatechange = function() {
									c(e), t.onreadystatechange = null, s.removeChild(t), t = null;
								}, s.appendChild(t);
							}) : function(e) {
								setTimeout(c, 0, e);`,
    after: `}) : function(e) {
								setTimeout(c, 0, e);`,
  },
], "docx/dist/index.mjs");
