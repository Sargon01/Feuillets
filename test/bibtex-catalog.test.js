import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import {
  parseBibtexCatalog,
  searchBibtexCatalog,
  getCachedBibtexCatalog,
  clearBibtexCatalogCache,
  isValidCitekey,
} from "../src/services/bibtex-catalog.js";

test("1. article entry is parsed correctly", () => {
  const bib = `@article{smith2024,
    author = {Smith, John},
    title = {Sample Article Title},
    year = {2024}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "smith2024");
  assert.equal(entries[0].type, "article");
  assert.equal(entries[0].title, "Sample Article Title");
  assert.deepEqual(entries[0].authors, ["Smith"]);
  assert.equal(entries[0].year, "2024");
});

test("2. book entry is parsed correctly", () => {
  const bib = `@book{brown2021,
    author = {Brown, Alex},
    title = {Sample Book Title},
    year = {2021}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "brown2021");
  assert.equal(entries[0].type, "book");
  assert.equal(entries[0].title, "Sample Book Title");
  assert.deepEqual(entries[0].authors, ["Brown"]);
  assert.equal(entries[0].year, "2021");
});

test("3. thesis entry is parsed correctly", () => {
  const bib = `@phdthesis{davis2020,
    author = {Davis, Clara},
    title = {Sample Doctoral Dissertation},
    year = {2020}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "davis2020");
  assert.equal(entries[0].type, "phdthesis");
  assert.equal(entries[0].title, "Sample Doctoral Dissertation");
  assert.deepEqual(entries[0].authors, ["Davis"]);
  assert.equal(entries[0].year, "2020");
});

test("4. quoted field values are handled", () => {
  const bib = `@article{quoted2022,
    author = "Taylor, Morgan",
    title = "Quoted Title Here",
    year = "2022"
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "quoted2022");
  assert.deepEqual(entries[0].authors, ["Taylor"]);
  assert.equal(entries[0].title, "Quoted Title Here");
  assert.equal(entries[0].year, "2022");
});

test("5. braced field values are handled", () => {
  const bib = `@article{braced2023,
    author = {Evans, Jordan},
    title = {Braced Title Example},
    year = {2023}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "braced2023");
  assert.deepEqual(entries[0].authors, ["Evans"]);
  assert.equal(entries[0].title, "Braced Title Example");
  assert.equal(entries[0].year, "2023");
});

test("6. nested braces in title are handled cleanly", () => {
  const bib = `@article{nested2024,
    author = {Green, Robin},
    title = {Analysis of {DNA} and {RNA} Sequences},
    year = {2024}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].title, "Analysis of DNA and RNA Sequences");
});

test("7. Unicode accents in keys, authors and titles are preserved", () => {
  const bib = `@article{müller2023,
    author = {Müller, François},
    title = {Étude Théorique Avancée},
    year = {2023}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "müller2023");
  assert.deepEqual(entries[0].authors, ["Müller"]);
  assert.equal(entries[0].title, "Étude Théorique Avancée");
});

test("8. institutional author with double braces is preserved", () => {
  const bib = `@report{who2021,
    author = {{World Health Organization}},
    title = {Global Guidance Report},
    year = {2021}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].authors, ["World Health Organization"]);
});

test("9. multiple authors separated by and are parsed", () => {
  const bib = `@article{multi2020,
    author = {Alpha, Aaron and Beta, Brian and Gamma, George},
    title = {Multi-author Collaboration},
    year = {2020}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].authors, ["Alpha", "Beta", "Gamma"]);
});

test("10. editor fallback is used when author is absent", () => {
  const bib = `@collection{editor2019,
    editor = {Johnson, Samuel},
    title = {Collected Essays},
    year = {2019}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].authors, ["Johnson"]);
});

test("11. date field fallback is used when year is absent", () => {
  const bib = `@article{dated2018,
    author = {Miller, Patrick},
    title = {Date-stamped Article},
    date = {2018-09-15}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].year, "2018");
});

test("12. entry without author is kept in catalog", () => {
  const bib = `@misc{noauthor2022,
    title = {Anonymous Whitepaper},
    year = {2022}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "noauthor2022");
  assert.deepEqual(entries[0].authors, []);
  assert.equal(entries[0].year, "2022");
});

test("13. entry without year is kept in catalog", () => {
  const bib = `@misc{noyear2024,
    author = {Harris, Arthur},
    title = {Undated Manuscript}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "noyear2024");
  assert.deepEqual(entries[0].authors, ["Harris"]);
  assert.equal(entries[0].year, "");
});

test("14. @string directive is ignored", () => {
  const bib = `@string{IEEE = "Institute of Electrical and Electronics Engineers"}
  @article{valid2024,
    author = {Wilson, Carl},
    title = {Test Article},
    year = {2024}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "valid2024");
});

test("15. @comment directive is ignored", () => {
  const bib = `@comment{This is a BibTeX comment}
  @article{valid2024,
    author = {Wilson, Carl},
    title = {Test Article},
    year = {2024}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "valid2024");
});

test("16. @preamble directive is ignored", () => {
  const bib = `@preamble{"\\makeatletter ... \\makeatother"}
  @article{valid2024,
    author = {Wilson, Carl},
    title = {Test Article},
    year = {2024}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "valid2024");
});

test("17. invalid citekeys with whitespace, control chars, [, ], @, comma, or semicolon are rejected", () => {
  assert.equal(isValidCitekey("has space"), false);
  assert.equal(isValidCitekey("has\tcontrol"), false);
  assert.equal(isValidCitekey("has[bracket"), false);
  assert.equal(isValidCitekey("has]bracket"), false);
  assert.equal(isValidCitekey("has@at"), false);
  assert.equal(isValidCitekey("has,comma"), false);
  assert.equal(isValidCitekey("has;semicolon"), false);
  assert.equal(isValidCitekey("validKey2024"), true);

  const bib = `
    @article{has space, author = {A}, year = {2024}}
    @article{has\tcontrol, author = {B}, year = {2024}}
    @article{has[bracket, author = {C}, year = {2024}}
    @article{has]bracket, author = {D}, year = {2024}}
    @article{has@at, author = {E}, year = {2024}}
    @article{has;semicolon, author = {G}, year = {2024}}
    @article{validKey2024, author = {H, Henry}, year = {2024}}
  `;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "validKey2024");
});

test("18. exact duplicate citekeys preserve the first entry", () => {
  const bib = `
    @article{dupKey,
      author = {FirstAuthor, Adam},
      title = {First Document},
      year = {2021}
    }
    @article{dupKey,
      author = {SecondAuthor, Bob},
      title = {Second Document},
      year = {2022}
    }
  `;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].key, "dupKey");
  assert.deepEqual(entries[0].authors, ["FirstAuthor"]);
  assert.equal(entries[0].title, "First Document");
});

test("19. malformed entry does not prevent reading subsequent valid entry", () => {
  const bib = `
    @article{brokenEntry,
      author = "Unclosed quote here,
      title = {Missing closing bracket
    @article{goodEntry2024,
      author = {Good, Gregory},
      title = {Solid Article},
      year = {2024}
    }
  `;
  const entries = parseBibtexCatalog(bib);
  assert.ok(entries.some((e) => e.key === "goodEntry2024"));
});

test("20. search by citekey", () => {
  const entries = [
    { key: "smith2024", type: "article", title: "Overview", authors: ["Smith"], year: "2024" },
    { key: "jones2023", type: "book", title: "Handbook", authors: ["Jones"], year: "2023" },
  ];
  const results = searchBibtexCatalog(entries, "smith");
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "smith2024");
});

test("21. search by author", () => {
  const entries = [
    { key: "itemA", type: "article", title: "A title", authors: ["Taylor"], year: "2020" },
    { key: "itemB", type: "book", title: "B title", authors: ["Miller"], year: "2021" },
  ];
  const results = searchBibtexCatalog(entries, "Taylor");
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "itemA");
});

test("22. search by title", () => {
  const entries = [
    { key: "itemA", type: "article", title: "Quantum Computing Basics", authors: ["Alpha"], year: "2020" },
    { key: "itemB", type: "book", title: "Classical Mechanics", authors: ["Beta"], year: "2021" },
  ];
  const results = searchBibtexCatalog(entries, "Quantum");
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "itemA");
});

test("23. search by year", () => {
  const entries = [
    { key: "itemA", type: "article", title: "First", authors: ["Alpha"], year: "1999" },
    { key: "itemB", type: "book", title: "Second", authors: ["Beta"], year: "2024" },
  ];
  const results = searchBibtexCatalog(entries, "1999");
  assert.equal(results.length, 1);
  assert.equal(results[0].key, "itemA");
});

test("24. search is case-insensitive", () => {
  const entries = [
    { key: "Smith2024", type: "article", title: "UPPERCASE TITLE", authors: ["SMITH"], year: "2024" },
  ];
  assert.equal(searchBibtexCatalog(entries, "smith2024").length, 1);
  assert.equal(searchBibtexCatalog(entries, "uppercase").length, 1);
  assert.equal(searchBibtexCatalog(entries, "smith").length, 1);
});

test("25. search is accent-insensitive", () => {
  const entries = [
    { key: "garcía2020", type: "book", title: "Théâtre et Poésie", authors: ["García"], year: "2020" },
  ];
  assert.equal(searchBibtexCatalog(entries, "garcia").length, 1);
  assert.equal(searchBibtexCatalog(entries, "theatre").length, 1);
  assert.equal(searchBibtexCatalog(entries, "poesie").length, 1);
});

test("26. ranking order: exact citekey > prefix > substring > author > title > year", () => {
  const entries = [
    { key: "otherYear", type: "article", title: "Random", authors: ["Nobody"], year: "2024" },
    { key: "refTitle", type: "article", title: "2024 in review", authors: ["Nobody"], year: "1990" },
    { key: "refAuthor", type: "article", title: "Random", authors: ["Year2024"], year: "1990" },
    { key: "sub2024extra", type: "article", title: "Random", authors: ["Nobody"], year: "1990" },
    { key: "2024prefix", type: "article", title: "Random", authors: ["Nobody"], year: "1990" },
    { key: "2024", type: "article", title: "Random", authors: ["Nobody"], year: "1990" },
  ];
  const results = searchBibtexCatalog(entries, "2024");
  assert.equal(results.length, 6);
  assert.equal(results[0].key, "2024"); // 1. exact citekey
  assert.equal(results[1].key, "2024prefix"); // 2. prefix
  assert.equal(results[2].key, "sub2024extra"); // 3. substring
  assert.equal(results[3].key, "refAuthor"); // 4. author
  assert.equal(results[4].key, "refTitle"); // 5. title
  assert.equal(results[5].key, "otherYear"); // 6. year
});

test("27. deterministic alphabetical tie-breaking on citekey", () => {
  const entries = [
    { key: "zebra2020", type: "article", title: "Physics", authors: ["Author"], year: "2020" },
    { key: "apple2020", type: "article", title: "Physics", authors: ["Author"], year: "2020" },
    { key: "mango2020", type: "article", title: "Physics", authors: ["Author"], year: "2020" },
  ];
  const results = searchBibtexCatalog(entries, "Physics");
  assert.deepEqual(results.map((r) => r.key), ["apple2020", "mango2020", "zebra2020"]);
});

test("28. default limit caps results at 50", () => {
  const entries = [];
  for (let i = 0; i < 60; i++) {
    const key = `key${String(i).padStart(3, "0")}`;
    entries.push({ key, type: "article", title: "Common Title", authors: ["Author"], year: "2020" });
  }
  const results = searchBibtexCatalog(entries, "Common");
  assert.equal(results.length, 50);
});

test("29. custom limit is respected", () => {
  const entries = [
    { key: "keyA", type: "article", title: "Same", authors: ["Author"], year: "2020" },
    { key: "keyB", type: "article", title: "Same", authors: ["Author"], year: "2020" },
    { key: "keyC", type: "article", title: "Same", authors: ["Author"], year: "2020" },
  ];
  const results = searchBibtexCatalog(entries, "Same", 2);
  assert.equal(results.length, 2);
});

test("30. source array is not modified by searchBibtexCatalog", () => {
  const entries = Object.freeze([
    { key: "keyZ", type: "article", title: "Common", authors: ["Author"], year: "2020" },
    { key: "keyA", type: "article", title: "Common", authors: ["Author"], year: "2020" },
  ]);
  const originalOrder = entries.map((e) => e.key);
  searchBibtexCatalog(entries, "Common");
  assert.deepEqual(entries.map((e) => e.key), originalOrder);
});

test("31. cache is reused when path, mtime and size are identical", async () => {
  clearBibtexCatalogCache();
  let reads = 0;
  const fakeFile = new TFile("biblio.bib");
  fakeFile.stat = { mtime: 1000, size: 200, ctime: 500 };

  const fakeApp = {
    vault: {
      cachedRead: async () => {
        reads++;
        return "@article{cachedKey, author = {Smith}, year = {2024}}";
      },
    },
  };

  const res1 = await getCachedBibtexCatalog(fakeApp, fakeFile);
  const res2 = await getCachedBibtexCatalog(fakeApp, fakeFile);

  assert.equal(reads, 1);
  assert.equal(res1, res2);
  assert.equal(res1.length, 1);
  assert.equal(res1[0].key, "cachedKey");
});

test("32. cache is re-read after mtime change", async () => {
  clearBibtexCatalogCache();
  let reads = 0;
  const fakeFile = new TFile("biblio.bib");
  fakeFile.stat = { mtime: 1000, size: 200, ctime: 500 };

  const fakeApp = {
    vault: {
      cachedRead: async () => {
        reads++;
        if (reads === 1) {
          return "@article{firstKey, author = {Smith}, year = {2024}}";
        }
        return "@article{updatedKey, author = {Smith}, year = {2024}}";
      },
    },
  };

  const res1 = await getCachedBibtexCatalog(fakeApp, fakeFile);
  assert.equal(res1[0].key, "firstKey");

  // Better BibTeX updates the file: mtime changes
  fakeFile.stat.mtime = 2000;
  const res2 = await getCachedBibtexCatalog(fakeApp, fakeFile);

  assert.equal(reads, 2);
  assert.equal(res2[0].key, "updatedKey");
});

test("33. cache is re-read after size change", async () => {
  clearBibtexCatalogCache();
  let reads = 0;
  const fakeFile = new TFile("biblio.bib");
  fakeFile.stat = { mtime: 1000, size: 200, ctime: 500 };

  const fakeApp = {
    vault: {
      cachedRead: async () => {
        reads++;
        return `@article{sizeKey${reads}, author = {Smith}, year = {2024}}`;
      },
    },
  };

  await getCachedBibtexCatalog(fakeApp, fakeFile);
  assert.equal(reads, 1);

  // Size changes
  fakeFile.stat.size = 250;
  const res2 = await getCachedBibtexCatalog(fakeApp, fakeFile);
  assert.equal(reads, 2);
  assert.equal(res2[0].key, "sizeKey2");
});

test("34. cache is re-read after path change", async () => {
  clearBibtexCatalogCache();
  let reads = 0;
  const fakeFileA = new TFile("biblioA.bib");
  fakeFileA.stat = { mtime: 1000, size: 200, ctime: 500 };

  const fakeFileB = new TFile("biblioB.bib");
  fakeFileB.stat = { mtime: 1000, size: 200, ctime: 500 };

  const fakeApp = {
    vault: {
      cachedRead: async (file) => {
        reads++;
        return `@article{keyFor_${file.path.replace(".bib", "")}, author = {Smith}, year = {2024}}`;
      },
    },
  };

  const resA = await getCachedBibtexCatalog(fakeApp, fakeFileA);
  const resB = await getCachedBibtexCatalog(fakeApp, fakeFileB);

  assert.equal(reads, 2);
  assert.equal(resA[0].key, "keyFor_biblioA");
  assert.equal(resB[0].key, "keyFor_biblioB");
});

test("35. extended bibliographic fields are parsed and cleaned", () => {
  const bib = `@article{complex2024,
    author = {Smith, John and Doe, Jane},
    editor = {Boss, Edward},
    title = {{A Complex Title with Braces}},
    publisher = {Academic Press},
    journal = {Journal of Testing},
    booktitle = {Proceedings of Testing},
    year = {2024},
    date = {2024-05-01},
    volume = {42},
    number = {7},
    pages = {100--115},
    doi = {10.1234/test.5678},
    url = {https://example.org/complex}
  }`;
  const entries = parseBibtexCatalog(bib);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.key, "complex2024");
  assert.equal(e.author, "Smith, John and Doe, Jane");
  assert.equal(e.editor, "Boss, Edward");
  assert.equal(e.title, "A Complex Title with Braces");
  assert.equal(e.publisher, "Academic Press");
  assert.equal(e.journal, "Journal of Testing");
  assert.equal(e.booktitle, "Proceedings of Testing");
  assert.equal(e.date, "2024-05-01");
  assert.equal(e.volume, "42");
  assert.equal(e.number, "7");
  assert.equal(e.pages, "100--115");
  assert.equal(e.doi, "10.1234/test.5678");
  assert.equal(e.url, "https://example.org/complex");
});
