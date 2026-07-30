import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform } from "obsidian";
import { pluginAbsoluteDir } from "../src/utils/plugin-dir.js";

function withEnvironment(callback) {
  const previousDesktop = Platform.isDesktop;
  const previousRequire = globalThis.require;
  try {
    callback();
  } finally {
    Platform.isDesktop = previousDesktop;
    globalThis.require = previousRequire;
  }
}

test("pluginAbsoluteDir : construit le chemin du plugin sur ordinateur", () => {
  withEnvironment(() => {
    Platform.isDesktop = true;
    const requests = [];
    globalThis.require = (name) => {
      requests.push(name);
      return { join: (...parts) => parts.join("/") };
    };
    const path = pluginAbsoluteDir(
      { vault: { adapter: { getBasePath: () => "/Users/test/Vault" } } },
      { dir: ".obsidian/plugins/feuillets" }
    );
    assert.equal(path, "/Users/test/Vault/.obsidian/plugins/feuillets");
    assert.deepEqual(requests, ["path"]);
  });
});

test("pluginAbsoluteDir : rejette un adaptateur sans chemin de base", () => {
  withEnvironment(() => {
    Platform.isDesktop = true;
    let required = false;
    globalThis.require = () => { required = true; throw new Error("Node ne doit pas être appelé"); };
    assert.throws(
      () => pluginAbsoluteDir({ vault: { adapter: {} } }, { dir: "feuillets" }),
      /Adaptateur de coffre incompatible/
    );
    assert.equal(required, false);
  });
});

test("pluginAbsoluteDir : ne charge pas Node sur mobile", () => {
  withEnvironment(() => {
    Platform.isDesktop = false;
    let required = false;
    globalThis.require = () => { required = true; throw new Error("Node ne doit pas être appelé"); };
    assert.throws(
      () => pluginAbsoluteDir({ vault: {} }, { dir: "feuillets" }),
      /uniquement sur ordinateur/
    );
    assert.equal(required, false);
  });
});
