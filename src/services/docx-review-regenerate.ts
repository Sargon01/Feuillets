import JSZip from "jszip";
import {
  ReviewChange,
  ReviewComment,
  RevisionRef,
  ReviewSourcePart,
  parseDocxReview,
} from "./docx-review-import.js";

export type RegenerateDecision = {
  applied: boolean;
  dismissed: boolean;
};

export type RegenerateParts = Record<string, string>;

export type RegenerateOptions = {
  parts: RegenerateParts;
  changes: ReviewChange[];
  comments?: ReviewComment[];
  savedStates: Record<string, RegenerateDecision>;
};

export type RegenerateResult =
  | {
      ok: true;
      parts: RegenerateParts;
      processedRefsCount: number;
    }
  | {
      ok: false;
      reason:
        | "revision-not-found"
        | "revision-duplicate"
        | "replacement-incomplete"
        | "move-incomplete"
        | "unsupported-footnote-move-regeneration"
        | "comment-resolution-unsupported"
        | "invalid-xml-structure"
        | string;
    };

export type RegenerateZipResult =
  | {
      ok: true;
      docxBuffer: ArrayBuffer;
      processedRefsCount: number;
    }
  | {
      ok: false;
      reason: string;
    };

export function getItemKey(item: any): string {
  const type = item.type || (item.isFormatting ? "formatting" : "comment");
  const author = item.author || "";
  const date = item.date || "";
  const ctx = item.contextBefore || item.fromContext || item.anchorText || "";
  const txt = item.text || item.newText || item.oldText || "";
  const ord = item.ord != null ? item.ord : "";
  return `${type}|${author}|${date}|${ctx}|${txt}|${ord}`;
}

function tagForKind(kind: RevisionRef["kind"]): string {
  switch (kind) {
    case "ins":
      return "w:ins";
    case "del":
      return "w:del";
    case "moveFrom":
      return "w:moveFrom";
    case "moveTo":
      return "w:moveTo";
    default:
      return "w:ins";
  }
}

function countTagWithId(xml: string, tagName: string, id: string): number {
  if (!xml) return 0;
  const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const regex = new RegExp(`<${tagName}\\b[^>]*\\bw:id="${escapedId}"[^>]*>`, "gi");
  const matches = xml.match(regex);
  return matches ? matches.length : 0;
}

type TagLocation = {
  startIndex: number;
  openTagEnd: number;
  closeTagStart: number;
  endIndex: number;
  innerBody: string;
  fullTag: string;
};

function findPairedTagWithId(xml: string, tagName: string, id: string): TagLocation | null {
  if (!xml) return null;
  const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const openRegex = new RegExp(`<${tagName}\\b[^>]*\\bw:id="${escapedId}"[^>]*>`, "i");
  const match = openRegex.exec(xml);
  if (!match) return null;

  const startIndex = match.index;
  const openTagEnd = startIndex + match[0].length;

  if (match[0].endsWith("/>")) {
    return {
      startIndex,
      openTagEnd,
      closeTagStart: openTagEnd,
      endIndex: openTagEnd,
      innerBody: "",
      fullTag: match[0],
    };
  }

  // Scan forward matching nested tags of same name until closing tag
  let depth = 1;
  let cursor = openTagEnd;
  const searchRegex = new RegExp(`(<${tagName}\\b[^>]*>)|(</${tagName}>)`, "gi");
  searchRegex.lastIndex = cursor;

  let m: RegExpExecArray | null;
  while ((m = searchRegex.exec(xml)) !== null) {
    if (m[1]) {
      if (!m[1].endsWith("/>")) {
        depth++;
      }
    } else if (m[2]) {
      depth--;
      if (depth === 0) {
        const closeTagStart = m.index;
        const endIndex = closeTagStart + m[0].length;
        return {
          startIndex,
          openTagEnd,
          closeTagStart,
          endIndex,
          innerBody: xml.slice(openTagEnd, closeTagStart),
          fullTag: xml.slice(startIndex, endIndex),
        };
      }
    }
  }

  return null;
}

function convertDelTextToT(body: string): string {
  return body.replace(/<w:delText\b([^>]*)>(.*?)<\/w:delText>/gis, "<w:t$1>$2</w:t>");
}

function removeRangeMarkers(xml: string, moveIdOrName: string): string {
  if (!xml || !moveIdOrName) return xml;
  const escaped = moveIdOrName.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const markerPattern = new RegExp(
    `<w:(moveFromRangeStart|moveFromRangeEnd|moveToRangeStart|moveToRangeEnd)\\b[^>]*\\b(w:id|name)="${escaped}"[^>]*\\/?>`,
    "gi"
  );
  let result = xml.replace(markerPattern, "");
  const anyMarkerPattern = /<w:(moveFromRangeStart|moveFromRangeEnd|moveToRangeStart|moveToRangeEnd)\b[^>]*\/>/gi;
  result = result.replace(anyMarkerPattern, "");
  return result;
}

function unwrapTagElement(
  xml: string,
  tagName: string,
  id: string,
  convertDelText: boolean = false
): { xml: string; success: boolean } {
  const loc = findPairedTagWithId(xml, tagName, id);
  if (!loc) return { xml, success: false };

  let replacementBody = loc.innerBody;
  if (convertDelText) {
    replacementBody = convertDelTextToT(replacementBody);
  }

  const updatedXml = xml.slice(0, loc.startIndex) + replacementBody + xml.slice(loc.endIndex);
  return { xml: updatedXml, success: true };
}

function removeTagElement(xml: string, tagName: string, id: string): { xml: string; success: boolean } {
  const loc = findPairedTagWithId(xml, tagName, id);
  if (!loc) return { xml, success: false };

  const updatedXml = xml.slice(0, loc.startIndex) + xml.slice(loc.endIndex);
  return { xml: updatedXml, success: true };
}

export function regenerateDocxParts(options: RegenerateOptions): RegenerateResult {
  const { parts, changes, comments = [], savedStates } = options;
  const modifiedParts: RegenerateParts = { ...parts };
  let processedRefsCount = 0;

  // 1. Identify targeted changes and comments
  type TargetedChange = {
    change: ReviewChange;
    action: "ACCEPT" | "REJECT";
  };

  type TargetedComment = {
    comment: ReviewComment;
    action: "RESOLVE" | "LEAVE";
  };

  const targetedChanges: TargetedChange[] = [];
  const targetedComments: TargetedComment[] = [];

  for (const c of changes) {
    const key = getItemKey(c);
    const saved = savedStates[key];
    if (!saved) continue;
    if (saved.applied === true) {
      targetedChanges.push({ change: c, action: "ACCEPT" });
    } else if (saved.applied === false && saved.dismissed === true) {
      targetedChanges.push({ change: c, action: "REJECT" });
    }
  }

  for (const com of comments) {
    const key = getItemKey(com);
    const saved = savedStates[key];
    if (!saved) continue;
    if (saved.dismissed === true || saved.applied === true) {
      targetedComments.push({ comment: com, action: "RESOLVE" });
    }
  }

  // 2. Atomic Pre-Check: Validate revisionRefs exist and are unique
  for (const { change } of targetedChanges) {
    // Unsupported check for move carrying footnotes without resolvable refs
    if (change.type === "move" && change.footnoteRefs?.length) {
      if (!change.revisionRefs || change.revisionRefs.length === 0) {
        return { ok: false, reason: "unsupported-footnote-move-regeneration" };
      }
    }

    if (!change.revisionRefs || change.revisionRefs.length === 0) {
      return { ok: false, reason: "revision-not-found" };
    }

    // Check atomicity for replacement and move
    if (change.type === "replacement") {
      const delRef = change.revisionRefs.find((r) => r.kind === "del");
      const insRef = change.revisionRefs.find((r) => r.kind === "ins");
      if (!delRef || !insRef) {
        return { ok: false, reason: "replacement-incomplete" };
      }
    }

    if (change.type === "move") {
      const fromRef = change.revisionRefs.find((r) => r.kind === "moveFrom" || r.kind === "del");
      const toRef = change.revisionRefs.find((r) => r.kind === "moveTo" || r.kind === "ins");
      if (!fromRef || !toRef) {
        return { ok: false, reason: "move-incomplete" };
      }
    }

    // Check presence & uniqueness of each ref ID in targeted XML part
    for (const ref of change.revisionRefs) {
      const partXml = modifiedParts[ref.part];
      if (!partXml) {
        return { ok: false, reason: "revision-not-found" };
      }
      const count = countTagWithId(partXml, tagForKind(ref.kind), ref.id);
      if (count === 0) {
        return { ok: false, reason: "revision-not-found" };
      }
      if (count > 1) {
        return { ok: false, reason: "revision-duplicate" };
      }
    }
  }

  // 3. Apply XML transformations for targeted changes
  for (const { change, action } of targetedChanges) {
    if (!change.revisionRefs) continue;

    for (const ref of change.revisionRefs) {
      const partXml = modifiedParts[ref.part];
      if (!partXml) continue;

      let updatedXml = partXml;

      if (ref.kind === "ins") {
        if (action === "ACCEPT") {
          const res = unwrapTagElement(updatedXml, "w:ins", ref.id, false);
          if (!res.success) return { ok: false, reason: "revision-not-found" };
          updatedXml = res.xml;
        } else {
          const res = removeTagElement(updatedXml, "w:ins", ref.id);
          if (!res.success) return { ok: false, reason: "revision-not-found" };
          updatedXml = res.xml;
        }
      } else if (ref.kind === "del") {
        if (action === "ACCEPT") {
          const res = removeTagElement(updatedXml, "w:del", ref.id);
          if (!res.success) return { ok: false, reason: "revision-not-found" };
          updatedXml = res.xml;
        } else {
          const res = unwrapTagElement(updatedXml, "w:del", ref.id, true);
          if (!res.success) return { ok: false, reason: "revision-not-found" };
          updatedXml = res.xml;
        }
      } else if (ref.kind === "moveFrom") {
        if (action === "ACCEPT") {
          const res = removeTagElement(updatedXml, "w:moveFrom", ref.id);
          if (!res.success) return { ok: false, reason: "revision-not-found" };
          updatedXml = res.xml;
        } else {
          const res = unwrapTagElement(updatedXml, "w:moveFrom", ref.id, true);
          if (!res.success) return { ok: false, reason: "revision-not-found" };
          updatedXml = res.xml;
        }
      } else if (ref.kind === "moveTo") {
        if (action === "ACCEPT") {
          const res = unwrapTagElement(updatedXml, "w:moveTo", ref.id, false);
          if (!res.success) return { ok: false, reason: "revision-not-found" };
          updatedXml = res.xml;
        } else {
          const res = removeTagElement(updatedXml, "w:moveTo", ref.id);
          if (!res.success) return { ok: false, reason: "revision-not-found" };
          updatedXml = res.xml;
        }
      }

      if (change.type === "move" && change.moveName) {
        updatedXml = removeRangeMarkers(updatedXml, change.moveName);
      }
      updatedXml = removeRangeMarkers(updatedXml, ref.id);

      modifiedParts[ref.part] = updatedXml;
      processedRefsCount++;
    }
  }

  // 4. Apply comment resolutions (in word/commentsExtended.xml if present)
  if (targetedComments.length > 0) {
    const extXml = modifiedParts["word/commentsExtended.xml"];
    if (extXml) {
      let updatedExtXml = extXml;
      for (const { comment } of targetedComments) {
        if (!comment.commentId) continue;
        const cid = comment.commentId;

        // Try to update w15:done="0" to w15:done="1" for w15:commentEx
        const escapedCid = cid.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
        const regex = new RegExp(`(<w15:commentEx\\b[^>]*\\bw15:paraIdParent="${escapedCid}"[^>]*)(>)`, "gi");
        if (regex.test(updatedExtXml)) {
          updatedExtXml = updatedExtXml.replace(regex, (m, p1, p2) => {
            if (p1.includes('w15:done="0"')) {
              return p1.replace('w15:done="0"', 'w15:done="1"') + p2;
            }
            if (!p1.includes("w15:done=")) {
              return p1 + ' w15:done="1"' + p2;
            }
            return m;
          });
        } else {
          // General matching on commentEx tag order or attributes
          const tagPattern = new RegExp(`(<w15:commentEx\\b[^>]*)(/?>)`, "g");
          let index = 0;
          const targetIndex = parseInt(cid, 10);
          updatedExtXml = updatedExtXml.replace(tagPattern, (m, p1, p2) => {
            if (index === targetIndex || (!isNaN(targetIndex) && index === targetIndex)) {
              index++;
              if (p1.includes('w15:done="0"')) return p1.replace('w15:done="0"', 'w15:done="1"') + p2;
              if (!p1.includes("w15:done=")) return p1 + ' w15:done="1"' + p2;
            }
            index++;
            return m;
          });
        }
      }
      modifiedParts["word/commentsExtended.xml"] = updatedExtXml;
    }
  }

  // 5. Post-transformation structural validation
  for (const { change } of targetedChanges) {
    if (!change.revisionRefs) continue;
    for (const ref of change.revisionRefs) {
      const partXml = modifiedParts[ref.part];
      if (partXml) {
        const remainingCount = countTagWithId(partXml, tagForKind(ref.kind), ref.id);
        if (remainingCount > 0) {
          return { ok: false, reason: "invalid-xml-structure" };
        }
      }
    }
  }

  return {
    ok: true,
    parts: modifiedParts,
    processedRefsCount,
  };
}

export async function regenerateDocxZip(
  docxArrayBuffer: ArrayBuffer,
  decisions: Record<string, RegenerateDecision>,
  parsedChanges?: ReviewChange[],
  parsedComments?: ReviewComment[]
): Promise<RegenerateZipResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(docxArrayBuffer);
  } catch (_e) {
    return { ok: false, reason: "invalid-xml-structure" };
  }

  const parts: RegenerateParts = {};
  const docFile = zip.file("word/document.xml");
  if (!docFile) {
    return { ok: false, reason: "invalid-xml-structure" };
  }
  parts["word/document.xml"] = await docFile.async("string");

  const fnFile = zip.file("word/footnotes.xml");
  if (fnFile) {
    parts["word/footnotes.xml"] = await fnFile.async("string");
  }

  const comFile = zip.file("word/comments.xml");
  if (comFile) {
    parts["word/comments.xml"] = await comFile.async("string");
  }

  const comExtFile = zip.file("word/commentsExtended.xml");
  if (comExtFile) {
    parts["word/commentsExtended.xml"] = await comExtFile.async("string");
  }

  let changes = parsedChanges;
  let comments = parsedComments;

  if (!changes || !comments) {
    const reviewResult = parseDocxReview(parts);
    const allChanges: ReviewChange[] = [];
    const allComments: ReviewComment[] = [];

    if (reviewResult.unclassified) {
      allChanges.push(...(reviewResult.unclassified.changes || []));
      allComments.push(...(reviewResult.unclassified.comments || []));
    }

    for (const bucket of Object.values(reviewResult.scenes || {}) as any[]) {
      allChanges.push(...(bucket.changes || []));
      allComments.push(...(bucket.comments || []));
    }

    changes = changes || allChanges;
    comments = comments || allComments;
  }

  const res = regenerateDocxParts({
    parts,
    changes,
    comments,
    savedStates: decisions,
  });

  if (!res.ok) {
    return { ok: false, reason: res.reason };
  }

  for (const [path, xmlContent] of Object.entries(res.parts)) {
    zip.file(path, xmlContent);
  }

  const outputBuffer = await zip.generateAsync({ type: "arraybuffer" });
  return {
    ok: true,
    docxBuffer: outputBuffer,
    processedRefsCount: res.processedRefsCount,
  };
}
