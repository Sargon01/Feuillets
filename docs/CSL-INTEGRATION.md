# Required Feuillets / CSL integration checks

`test/csl-companion-integration.test.js` exercises the real companion, `citeproc-ts`,
host contract, Live Preview, Reading Mode, Continu, static rendering and paginated
Preview. It also checks two bibliographies, resource repairs and genuine fatal
style errors. Only Obsidian and the initial Markdown renderer are stubbed.

## Local checks before pushing

Install each checkout's dependencies separately. No personal bibliography is needed.

```sh
cd /path/to/Feuillets-CSL
npm ci
npm test
cd /path/to/Feuillets
npm ci
npx playwright install chromium
FEUILLETS_CSL_SOURCE=/path/to/Feuillets-CSL npm run test:csl-integration
```

The dedicated command always forces `FEUILLETS_CSL_REQUIRED=1`. It fails if the
source or Chromium is missing, an assertion fails, or the named integration test
and its synthetic child have not passed without skips. Ordinary local `npm test`
can still skip integration when no companion is configured. The CI integration
gate cannot opt out by setting `FEUILLETS_CSL_REQUIRED=0`.

For repeatable version compatibility measurements, archive the desired revisions
to separate directories, install their dependencies, and run:

```sh
node scripts/check-csl-compatibility.mjs \
  --host /path/to/Feuillets-snapshot \
  --companion /path/to/Feuillets-CSL-snapshot \
  --host-kind published --companion-kind corrected \
  --style /path/to/public-chicago-style.csl
```

The kind arguments select the independently asserted, known expectations for the
published and corrected revisions. Output records registration, API version,
rendered groups, host acceptance and diagnostic codes, without private data.

## CI and release pinning

Feuillets CI and release workflows require repository variable `FEUILLETS_CSL_REF`
to be a full, reviewed, remotely available 40-character commit SHA from the public
`Sargon01/Feuillets-CSL` repository. Empty pins, branches and tags are rejected;
there is no fallback to a moving `main` or an old released companion.

The event's Feuillets revision and pinned companion are checked out as siblings
(`feuillets` / `feuillets-csl`). Each uses its own lockfile and dependency directory,
so lint and compilation do not scan a nested vendor repository. Both full tests
and the dedicated, mandatory integration gate run before building or releasing.
No personal token or private repository is required.

The companion CI uses the reverse pin, repository variable `FEUILLETS_HOST_REF`.
Its release workflow additionally requires that pinned host commit to be publicly
released. A published Feuillets tag whose commit differs from the pin is rejected.

Repository variables are intentional operational prerequisites. They are not
configured by a code change. Missing configuration must fail visibly; it must
never make integration optional. Changing a pin requires review and a green check
against that exact revision. Keep the paired SHAs in the PR and release validation
record. Do not move the pin during an active release run.

## Integration and publication order

The corrections are `6ed59b6` (Feuillets) and `1d656f3` (companion). They were local
when this workflow change was prepared; no workflow claims they are fetchable.

1. Complete the local tests against both corrected checkouts and review this CI
   change. Obtain authorization before creating any additional commits or pushes.
2. Push the reviewed companion candidate and host branch only after authorization.
   Source code can be made remotely available without creating a release.
3. Verify the remote commits, then configure Feuillets' `FEUILLETS_CSL_REF` with
   the corrected companion SHA and the companion's `FEUILLETS_HOST_REF` with the
   host SHA containing the corrected contract and mandatory test command. Configure
   these before opening the PRs, so required checks do not fail on missing setup.
4. Open the two PRs. Standard checkout tests each event's candidate against the
   other repository's pinned candidate. Require the `Build and Test` check in each
   repository's branch protection; a YAML workflow alone cannot enforce merging.
5. Integrate the host fix/CI change through its dedicated branch, preserving the
   main checkout's uncommitted search work. Integrate the companion fix/CI/docs as
   a separate change. The checks also run on `main`. Neither integration publishes
   a plugin version.
6. Publish the first Feuillets release containing `6ed59b6` and the integration
   gate. No release number is assigned by this change.
7. Set the companion's `FEUILLETS_HOST_REF` to that released tag's peeled commit,
   rerun checks, and only then publish the corrected companion. Its release guard
   verifies host availability and the exact released commit before publication.
8. When suitable, update Feuillets' companion pin to the reviewed released
   companion commit and rerun checks. Keep immutable SHAs, never temporary branches.

The current host branch also inherits the preexisting search commit `2758c6a`,
which is not in the published 3.5.2 tag. This CI change does not alter that commit
or the remaining uncommitted search work. Before a narrowly scoped host PR, review
whether that existing parent has already been integrated. If not, obtain separate
approval for its integration first, or explicitly review its inclusion in the
host PR. Do not rewrite or transplant the preserved correction commits to hide it.

## User compatibility

All four measured pairs register through API v2. The published companion 0.1.3
still fails globally on unsupported types or duplicates, and can accept unsafe
cyclic inheritance, even with a corrected host. A corrected companion with
published Feuillets 3.5.2 renders valid libraries and isolates unused bad entries,
but the host rejects the complete result when a bad entry is cited. Both corrected
versions are required for full isolation of those cited-entry diagnostics.

Unknown-key groups stay raw in all four pairs; independent valid groups render
when no inherited global bibliography failure is present. Mixed groups remain
atomic. Users should update Feuillets first and the companion second, without
replacing their `.bib` or `.csl` files. See the companion's tested compatibility
matrix in `docs/compatibility.md`.
