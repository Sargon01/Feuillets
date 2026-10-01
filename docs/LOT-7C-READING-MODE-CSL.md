# Lot 7C: native CSL in standard Reading Mode

## Audit recorded before implementation

The existing Reading Mode service, CSL host, Pandoc parser, safe AST renderer,
Live Preview integration, relevant `main.ts` registration/invalidation/settings
paths, and their tests were inspected before coding. The installed Obsidian API
declarations and the installed Obsidian 1.13.7 renderer implementation were also
read. No UI smoke test has been performed by this implementation task.

1. **Post-processor sections.** Obsidian invokes processors separately for
   preview sections. A section can be detached during processing or virtualized;
   `containerEl.contains(el)` alone cannot reliably identify its owner. Processing
   order is unrelated to citation order.
2. **Context.** The public context exposes `docId`, `sourcePath`, `frontmatter`,
   `addChild()` and `getSectionInfo()`. It does not expose the owning MarkdownView.
   The API explicitly permits null section information and requires querying it
   immediately before use. See the [official API declarations](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts).
3. **File resolution.** Only `ctx.sourcePath` resolves the source file through
   `vault.getAbstractFileByPath()`. The saved complete Markdown is read with
   `vault.read(file)`. Active-file APIs and DOM concatenation are never used.
4. **Section source.** In the inspected runtime, `getSectionInfo()` returns the
   complete renderer source as `text` and zero-based inclusive `lineStart` /
   `lineEnd`. Source must exactly equal the Vault read; bounds must be valid.
   Information is queried again after the asynchronous render. Missing or stale
   metadata fails closed. Relocated footnotes and callouts are excluded because
   their section/DOM correspondence cannot be guaranteed for this lot.
5. **Public rendering identity (corrected after external audit).** The public
   `ctx.docId` identifies the renderer. The inspected runtime assigns it once
   and passes the same ID into each section context. No MarkdownView lookup or
   private renderer field is needed to identify a session. Missing public IDs or
   paths, inconsistent ownerDocuments, and identity changes while awaiting a
   render fail closed. The original `findOwner()` check of `previewMode.docId`,
   its structural property probe, and the additional view counter were removed.
6. **Two panes.** Sessions are indexed by public `ctx.docId`; the deterministic
   logical ID is `reading-mode:<ctx.docId>:<normalized-source-path>`. Different
   public renderer IDs isolate panes of the same file. All sections of one
   renderer/file share the same promise and session. No local counter is needed.
7. **Cleanup.** A MarkdownRenderChild per section accounts for its lifecycle,
   including provider-unavailable states. The last section unload disposes the
   logical session through the Host. The public context's render-child lifecycle
   covers closing the renderer, destructive rerender and file changes,
   including while provider/Vault work is pending. A new sourcePath
   in an existing public context also disposes the previous session immediately;
   delayed old-child teardown cannot dispose its replacement. Plugin teardown unsubscribes the Host,
   cancels queued refreshes and disposes every Reading session. Delayed Vault or
   provider completion cannot write obsolete DOM or start a session after close.

## Implementation

`registerPandocCitationReadingMode()` branches on the existing preview setting:
off does nothing, author-date keeps the existing catalog/wrapper/tooltips, and CSL
uses the existing CslCitationHost. No public provider contract, parser, provider,
runtime dependency, export, Continu or paginated preview has changed.

Each public renderer/file session caches one promise spanning both the full Vault read and
the Host render. Simultaneous sections await that promise; subsequent sections
reuse its result, including failure states until invalidation. Section count or
viewport order never changes provider revisions or cluster IDs. The Host receives
every parsed cluster in original document order with `includeBibliography: false`.

Global occurrences are filtered by the verified source line range. Complete raw
syntax is located in that source range and DOM text nodes, including protected
literal copies. Only equal source/DOM counts with matching relative order can be
paired. Eligible replacements refer to the original global `clusterId`; repeated
keys or identical raw syntax never become citekey-only lookups. Unmatched syntax,
split text, ambiguous counts and reordered output stay raw. Source ranges are
never independently rendered or assigned local cluster IDs.

The CSL root uses the same scoped span helper as Live Preview, with class
`feuillets-csl-citation`. `RenderedCitation.content` is rendered by the existing
safe AST renderer in the text node's ownerDocument. That renderer allows only
contract-supported safe http/https/mailto links; unsafe links become neutral
spans. No HTML parsing or global document fallback is introduced.

Provider/resource/result errors, error diagnostics (including UNKNOWN_CITEKEY),
and missing document clusters invalidate the entire Reading result. There is no
author-date fallback, Notice or console logging. Mapping failures preserve the
affected raw syntax. Code, PRE, SCRIPT, STYLE, Markdown links, embeds, callouts,
footnote definitions and sections containing inline footnotes remain protected.
For `^[Voir [@doe2023, p. 57] pour une discussion.]`, the unchanged global parser
still sends only `[@doe2023, p. 57]`, with `noteIndex === undefined`; the Reading
section remains raw. No CSL note semantics or bibliography injection is added.

## Invalidation

There is one coalesced Reading-view refresh function. It re-resolves resources
per view/file, translates affected Host document IDs into saved source paths, and
queues at most one full rerender per view per microtask. Reading state is cleared
before rerender; provider disposal remains a Host operation.

MarkdownView enumeration is retained only in the refresh function, to select
open preview views and call the public `previewMode.rerender(true)`. It does not
identify or own sessions. Panes of an affected saved file share its resources and
settings, so all such Reading panes are refreshed, while their context sessions
remain independent. No private renderer identity or lifecycle subscription to a
guessed view is used. Rendering detached sections works without enumerating any
MarkdownView; the public render children account for their lifetime.

`main.ts` retains its existing Vault event pipeline: bibliography changes notify
legacy catalog users, both bibliography and CSL changes invalidate the Host and
refresh affected Reading views, and create/delete/rename or settings changes use
`refreshCitationRendering()` and global Host invalidation. Global refresh also
includes currently off views to handle style transitions. Registry changes wake
open Reading views even when no provider session previously existed. Rendering
and disposing a document never emit invalidation, so rerenders cannot create an
invalidation loop.

## Real Obsidian smoke test (pending user validation)

Use the built core plugin and the existing Feuillets CSL provider, a bibliography
containing the named entries, and a genuine Chicago Author-Date style. Set the
project preview style to CSL, save the following note, and compare Live Preview
with standard Reading Mode:

```markdown
Simple [@smith2024].

Locator [@doe2023, p. 42].

Group [@smith2024; @garcia2020, pp. 12–14].

Narrative @who2021.
```

| Check | Expected in both views, with the reference bibliography/style |
| --- | --- |
| A: simple | `(Smith 2024)` |
| B: locator | `(Doe et Brown 2023, 42)` |
| C: group | `(Smith 2024; García Márquez 2020, 12–14)` |
| D: narrative | `World Health Organization (2021)` |

E. Select a genuine IEEE style and save a document containing `[@alpha]` before
`[@beta]`, separated by several paragraphs. Scroll directly to the second
section: it must show `[2]`, including after rerender, matching the full document.

F. Add an unknown citekey and save. The complete Reading document must remain
raw, including its known citations, when the provider reports document failure.

G. With Reading Mode open, disable Feuillets CSL: raw syntax must return. Enable
it: CSL must return without reopening the note.

H. Edit and save the selected `.csl`, then change the selected style path through
project/workspace settings. Reading Mode must refresh to the new style. Also
modify the `.bib`, delete/recreate a selected resource, and rename one: resource
resolution and fail-closed behavior must update without reopening the note.

Open two Reading panes of the same note, close one, and verify the other remains
functional. Open two articles inheriting different research folders/resources
while another file is active, then repeat a resource modification: only affected
panes should refresh. Repeat a citation in a popout window. Confirm code, link
labels, inline notes and callouts remain raw, with link destinations untouched.
Select historical author-date, then off, to verify the existing tooltip behavior
and raw syntax respectively. No final bibliography should appear.

## Validation results

- Dedicated CSL Reading Mode suite: 51 passing tests (8 new identity/lifecycle
  tests, with existing fixtures and assertions updated to public context IDs).
- Combined Reading Mode, historical Reading Mode, CSL Host, CSL Live Preview
  and parser suites: 152 passing tests.
- `npm test`: 7,321 total, 7,303 passed, 18 skipped, zero failures.
- `npm run lint`: passed; 22 existing warnings in unchanged files.
- `npm run lint:obsidian`: passed with zero errors or warnings.
- `npm run build`: passed.
- `git diff --check`: passed.
- Production `main.js`: 2,787,313 bytes.
- No commit or push was performed. Real Obsidian smoke testing is pending.
