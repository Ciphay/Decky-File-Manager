import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getLocale, t, tf } from "../../src/i18n";

const LOCALES = ["en", "pt-BR", "es", "fr", "de", "zh-CN"];
const load = (locale: string): Record<string, string> => JSON.parse(readFileSync(join("locales", `${locale}.json`), "utf8"));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });

describe("i18n runtime", () => {
  it("translates, falls back to the key, and interpolates", () => {
    expect(getLocale()).toBe("en");
    expect(t("action.cancel")).toBe("Cancel");
    expect(t("this.key.does.not.exist")).toBe("this.key.does.not.exist");
    expect(tf("conflict.message", { name: "x.txt" })).toBe('Destination already contains "x.txt".');
    expect(tf("action.show_more", { count: 3 })).toContain("3");
    expect(tf("missing.{a}.key", { a: 1 })).toBe("missing.1.key");
  });
});

describe("locale files", () => {
  const english = load("en");

  it("have exactly the same keys in every language", () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(load(locale));
      expect(keys.filter((k) => !(k in english)), `${locale} extra`).toEqual([]);
      expect(Object.keys(english).filter((k) => !keys.includes(k)), `${locale} missing`).toEqual([]);
    }
  });

  it("have no empty values and keep placeholders consistent", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(load(locale))) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
        const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(",");
        expect(placeholders(value), `${locale}:${key}`).toBe(placeholders(english[key]));
      }
    }
  });

  it("define every key referenced with t()/tf() in the source", () => {
    const used = new Set<string>();
    for (const file of sourceFiles("src")) {
      for (const match of readFileSync(file, "utf8").matchAll(/\bt[f]?\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(match[1]);
    }
    expect([...used].filter((key) => !(key in english))).toEqual([]);
  });
});
