# Content variants, extractions and collections

> [Français](VARIANTES-EXTRACTIONS-COLLECTIONS.md) · **English** · [Documentation index](README.md)

Feuillets can produce several outputs from the same manuscript without duplicating the source Markdown.

| Feature | What is kept | Example |
|---|---|---|
| **Variant** | The document, minus selected roles | Student version without solutions |
| **Extraction** | Whole structural sections containing selected roles | All activities containing questions |
| **Collection** | Selected semantic blocks with heading context | Glossary or evidence file |

Roles remain optional. If you do not use these features, the manuscript behaves like an ordinary Markdown document.

## Content variant

A variant keeps document structure and ordinary text while excluding selected roles.

Typical uses:

- student / corrected version;
- public / internal report;
- document without recommendations;
- document without answers.

A variant can also keep or hide answer space associated with questions.

## Content extraction

An extraction keeps **whole structural sections** when they contain at least one trigger role.

The structure comes from Markdown headings.

Use an extraction when the role identifies a relevant section but the complete local context must remain.

Examples:

- every activity containing `questions`;
- every section containing `methode`;
- every section containing `recommandation`.

## Content collection

A collection keeps only blocks carrying selected roles and restores the heading context needed to understand them.

Typical collections:

- glossary: `definition`;
- evidence/document file: `preuve + source + citation`;
- summary sheet: `synthese + point-cle`;
- recommendations: `recommandation`.

## Combining with a variant

A variant remains independent from a content derivation.

For example:

1. Collection: `definition + source`
2. Variant: exclude `source`

Result:

- definitions remain;
- sources disappear;
- ordinary text outside the collection is absent.

Extraction and collection are alternative derivation modes: choose one **or** the other.

## Where to configure them

Open **Edition → Composition → Manuscript**:

- **Content variants**
- **Content extractions**
- **Content collections**

Names are user-defined. Feuillets does not impose built-in “student”, “teacher”, “audit” or similar publishing profiles.

## Export toolbar

The compact Edition toolbar follows:

**Scope → Content → Format → Export**

### Scope

Chooses which files are involved.

### Content

Choose:

- **Full document**
- an extraction
- a collection

### Format

Chooses the output format.

### Export

Runs the export with the current choices.

## Markdown export

Markdown export remains a source export. An active extraction or collection does not rewrite the exported `.md`.

## Remember

- **Variant** = same document, selected roles hidden.
- **Extraction** = whole sections located through roles.
- **Collection** = role blocks themselves, with heading context.

See [Semantic roles](SEMANTIC-ROLES.md) and the [tutorial](SEMANTIC-PUBLISHING-TUTORIAL.md).
