import JSZip from "jszip";
import {
  ReviewChange,
  ReviewComment,
  RevisionRef,
  MoveRangeRef,
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
        | "missing-parsed-changes"
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
  if (!xml || !id) return 0;
  const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const regex = new RegExp(`<${tagName}\\b[^>]*\\bw:id="${escapedId}"[^>]*>`, "gi");
  const matches = xml.match(regex);
  return matches ? matches.length : 0;
}

function countRangeMarkerWithId(xml: string, markerType: "start" | "end", kind: "moveFromRange" | "moveToRange", id: string): number {
  if (!xml || !id) return 0;
  const escapedId = id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const tagName =
    kind === "moveFromRange"
      ? markerType === "start"
        ? "w:moveFromRangeStart"
        : "w:moveFromRangeEnd"
      : markerType === "start"
      ? "w:moveToRangeStart"
      : "w:moveToRangeEnd";
  const regex = new RegExp(`<${tagName}\\b[^>]*\\bw:id="${escapedId}"[^>]*\\/?>`, "gi");
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
  if (!xml || !id) return null;
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

function removeRangeMarkerById(
  xml: string,
  id: string,
  kind: "moveFromRange" | "moveToRange"
): { xml: string; success: boolean } {
  if (!xml || !id) return { xml, success: false };
  const escaped = id.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const startTag = kind === "moveFromRange" ? "w:moveFromRangeStart" : "w:moveToRangeStart";
  const endTag = kind === "moveFromRange" ? "w:moveFromRangeEnd" : "w:moveToRangeEnd";

  const startRegex = new RegExp(`<${startTag}\\b[^>]*\\bw:id="${escaped}"[^>]*\\/?>`, "i");
  const endRegex = new RegExp(`<${endTag}\\b[^>]*\\bw:id="${escaped}"[^>]*\\/?>`, "i");

  const hasStart = startRegex.test(xml);
  const hasEnd = endRegex.test(xml);

  if (!hasStart && !hasEnd) return { xml, success: false };

  let updated = xml.replace(startRegex, "");
  updated = updated.replace(endRegex, "");
  return { xml: updated, success: true };
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
    action: "RESOLVE";
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

  // 2. Pre-Check: Refuse moves carrying footnotes (Section 4)
  for (const { change } of targetedChanges) {
    if (
      change.type === "move" &&
      ((change.footnoteRefs && change.footnoteRefs.length > 0) ||
        (change.originFootnoteIds && change.originFootnoteIds.length > 0) ||
        (change.destFootnoteIds && change.destFootnoteIds.length > 0))
    ) {
      return { ok: false, reason: "unsupported-footnote-move-regeneration" };
    }
  }

  // 3. Atomic Pre-Check: Validate revisionRefs & moveRangeRefs exist and are unique
  for (const { change } of targetedChanges) {
    if (!change.revisionRefs || change.revisionRefs.length === 0) {
      return { ok: false, reason: "revision-not-found" };
    }

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

    for (const rangeRef of change.moveRangeRefs || []) {
      const partXml = modifiedParts[rangeRef.part];
      if (!partXml) {
        return { ok: false, reason: "revision-not-found" };
      }
      const startCount = countRangeMarkerWithId(partXml, "start", rangeRef.kind, rangeRef.id);
      const endCount = countRangeMarkerWithId(partXml, "end", rangeRef.kind, rangeRef.id);
      if (startCount === 0 || endCount === 0) {
        return { ok: false, reason: "revision-not-found" };
      }
      if (startCount > 1 || endCount > 1) {
        return { ok: false, reason: "revision-duplicate" };
      }
    }
  }

  // 4. Pre-Check: Validate commentsExtended paraId (Section 3)
  const extXml = modifiedParts["word/commentsExtended.xml"];
  if (targetedComments.length > 0 && extXml) {
    for (const { comment } of targetedComments) {
      if (!comment.commentExtendedParaId) {
        return { ok: false, reason: "comment-resolution-unsupported" };
      }
      const escapedParaId = comment.commentExtendedParaId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const regex = new RegExp(`<w15:commentEx\\b[^>]*\\bw15:paraId="${escapedParaId}"[^>]*\\/?>`, "gi");
      const matches = extXml.match(regex);
      if (!matches || matches.length === 0) {
        return { ok: false, reason: "comment-resolution-unsupported" };
      }
      if (matches.length > 1) {
        return { ok: false, reason: "revision-duplicate" };
      }
    }
  }

  // 5. Apply XML transformations for targeted changes
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

      modifiedParts[ref.part] = updatedXml;
      processedRefsCount++;
    }

    for (const rangeRef of change.moveRangeRefs || []) {
      const partXml = modifiedParts[rangeRef.part];
      if (!partXml) continue;

      const res = removeRangeMarkerById(partXml, rangeRef.id, rangeRef.kind);
      if (!res.success) return { ok: false, reason: "revision-not-found" };
      modifiedParts[rangeRef.part] = res.xml;
    }
  }

  // 6. Apply comment resolutions (strictly by w15:paraId)
  if (targetedComments.length > 0 && extXml) {
    let updatedExtXml = modifiedParts["word/commentsExtended.xml"];
    for (const { comment } of targetedComments) {
      if (!comment.commentExtendedParaId) continue;
      const paraId = comment.commentExtendedParaId;
      const escapedParaId = paraId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const commentExPattern = new RegExp(`<w15:commentEx\\b[^>]*\\bw15:paraId="${escapedParaId}"[^>]*\\/?>`, "gi");

      updatedExtXml = updatedExtXml.replace(commentExPattern, (tag) => {
        if (tag.includes('w15:done="0"')) {
          return tag.replace('w15:done="0"', 'w15:done="1"');
        }
        if (tag.includes('w15:done="1"')) {
          return tag;
        }
        if (tag.endsWith("/>")) {
          return tag.slice(0, -2) + ' w15:done="1"/>';
        }
        return tag.slice(0, -1) + ' w15:done="1">';
      });
    }
    modifiedParts["word/commentsExtended.xml"] = updatedExtXml;
  }

  // 7. Post-transformation structural validation
  for (const { change } of targetedChanges) {
    if (change.revisionRefs) {
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

    if (change.moveRangeRefs) {
      for (const rangeRef of change.moveRangeRefs) {
        const partXml = modifiedParts[rangeRef.part];
        if (partXml) {
          const remainingStart = countRangeMarkerWithId(partXml, "start", rangeRef.kind, rangeRef.id);
          const remainingEnd = countRangeMarkerWithId(partXml, "end", rangeRef.kind, rangeRef.id);
          if (remainingStart > 0 || remainingEnd > 0) {
            return { ok: false, reason: "invalid-xml-structure" };
          }
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
  if (!parsedChanges || !parsedComments) {
    return { ok: false, reason: "missing-parsed-changes" };
  }

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

  const res = regenerateDocxParts({
    parts,
    changes: parsedChanges,
    comments: parsedComments,
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
