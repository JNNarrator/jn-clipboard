import { describe, expect, test } from "vitest";
import { highlightCode, looksLikeJson, tokenizeGeneric, tokenizeJson } from "./codeHighlight";

const kinds = (tokens: { kind: string }[]) => tokens.map((t) => t.kind);
const text = (tokens: { text: string }[]) => tokens.map((t) => t.text).join("");

describe("tokenizeJson", () => {
  test("keys, strings, numbers and literals get distinct kinds", () => {
    const src = '{"host": "gm", "port": 21236, "tls": true, "path": null}';
    const tokens = tokenizeJson(src);
    expect(text(tokens)).toBe(src); // lossless
    expect(kinds(tokens)).toContain("key");
    expect(kinds(tokens)).toContain("string");
    expect(kinds(tokens)).toContain("number");
    expect(kinds(tokens)).toContain("literal");

    const keyIdx = tokens.findIndex((t) => t.kind === "key");
    expect(tokens[keyIdx].text).toBe('"host"');
  });

  test("escaped quotes inside strings stay one token", () => {
    const src = '"say \\"hi\\""';
    expect(text(tokenizeJson(src))).toBe(src);
    expect(kinds(tokenizeJson(src))).toEqual(["string"]);
  });

  test("nested structure keeps key/string distinction", () => {
    const src = JSON.stringify({ outer: { inner: "value" } });
    const tokens = tokenizeJson(src);
    const keys = tokens.filter((t) => t.kind === "key").map((t) => t.text);
    expect(keys).toEqual(['"outer"', '"inner"']);
    expect(tokens.find((t) => t.kind === "string")?.text).toBe('"value"');
  });
});

describe("tokenizeGeneric", () => {
  test("strings, numbers, comments and keywords", () => {
    const src = 'const url = "https://example"; // 8080 timeout\nlet x = 42';
    const tokens = tokenizeGeneric(src);
    expect(text(tokens)).toBe(src);
    expect(tokens.find((t) => t.kind === "key")?.text).toBe("const");
    expect(tokens.find((t) => t.kind === "string")?.text).toBe('"https://example"');
    expect(tokens.some((t) => t.kind === "comment" && t.text.startsWith("//"))).toBe(true);
    expect(tokens.some((t) => t.kind === "number" && t.text === "42")).toBe(true);
  });

  test("shell-style # comments count", () => {
    const tokens = tokenizeGeneric("ssh gm # staging server");
    expect(tokens.some((t) => t.kind === "comment" && t.text === "# staging server")).toBe(true);
  });
});

describe("highlightCode", () => {
  test("valid JSON documents take JSON mode", () => {
    const tokens = highlightCode('{"a": 1}');
    expect(tokens).not.toBeNull();
    expect(kinds(tokens!)).toContain("key");
  });

  test("a JS object that is not JSON falls back to generic", () => {
    // Single quotes: JSON.parse fails → generic colorer handles it.
    const tokens = highlightCode("{ a: 'b' }");
    expect(tokens).not.toBeNull();
    expect(tokens!.some((t) => t.kind === "string")).toBe(true);
  });

  test("oversized or empty input returns null (plain text)", () => {
    expect(highlightCode("")).toBeNull();
    expect(highlightCode("x".repeat(20001))).toBeNull();
  });
});

describe("looksLikeJson", () => {
  test("leading brace or bracket, whitespace tolerated", () => {
    expect(looksLikeJson('  {"a":1}')).toBe(true);
    expect(looksLikeJson("[1]")).toBe(true);
    expect(looksLikeJson("const x = {}")).toBe(false);
  });
});
