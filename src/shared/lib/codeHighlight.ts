/**
 * A deliberately tiny syntax colorer for clipboard code previews.
 *
 * Scope: JSON (full fidelity — keys, strings, numbers, booleans, null) plus a
 * small generic fallback (strings, numbers, line comments) for other code
 * snippets. It is not a language engine; it exists so a code entry read in the
 * list or the detail pane has visible structure at a glance. Anything this
 * cannot see stays plain — a mis-colored pretender is worse than plain text.
 *
 * The output is token spans with **no markup**: callers decide how to render
 * (`<span className="tok-k">` in the webview, plain text anywhere else).
 */

export type CodeTokenKind = "key" | "string" | "number" | "literal" | "comment" | "text";

export interface CodeToken {
  text: string;
  kind: CodeTokenKind;
}

/** Over this size a snippet is "data", not "code to read": coloring it costs
 *  more than it returns. List previews truncate far earlier anyway; this cap
 *  protects the detail pane. */
export const CODE_HIGHLIGHT_MAX_CHARS = 20_000;

// JS/TS/shell keyword set for the generic fallback. Kept to the ones that
// read as structure, not an exhaustive list.
const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "class", "import", "export", "from", "async", "await", "try", "catch",
  "throw", "new", "typeof", "interface", "type", "enum", "extends", "implements",
  "pub", "fn", "let", "mut", "struct", "impl", "match", "use", "def", "self", "None", "True", "False",
]);

/**
 * JSON mode: strict shape (starts with { or [ after whitespace), then
 * token-by-token. Keys are strings followed by a colon — the property-name
 * color is the thing that makes JSON scannable.
 */
export function looksLikeJson(text: string): boolean {
  const first = text.trimStart()[0];
  return first === "{" || first === "[";
}

export function tokenizeJson(text: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let i = 0;
  let pendingKey = false; // after a value, a following string is a key

  const push = (text: string, kind: CodeTokenKind) => {
    if (text) tokens.push({ text, kind });
  };

  while (i < text.length) {
    const rest = text.slice(i);
    const ch = rest[0];

    // Whitespace and structure carry no color of their own.
    const structMatch = /^[\s:{}[\],]+/.exec(rest);
    if (structMatch) {
      // A string that follows this run is a key only when the run *ends*
      // with an opener ( `{` `[` ) or a separator ( `,` ) — a run ending
      // with `:` introduces a value instead.
      const runEnd = structMatch[0].slice(-1);
      pendingKey = runEnd === "{" || runEnd === "[" || runEnd === ",";
      push(structMatch[0], "text");
      i += structMatch[0].length;
      continue;
    }

    if (ch === '"') {
      const strMatch = /^"(?:[^"\\]|\\.)*"/.exec(rest);
      if (strMatch) {
        push(strMatch[0], pendingKey ? "key" : "string");
        i += strMatch[0].length;
        // A key ends at its closing quote; the next `:` is structural.
        pendingKey = false;
        continue;
      }
      // Unterminated string: color the rest as a string.
      push(rest, "string");
      break;
    }

    const numMatch = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (numMatch) {
      push(numMatch[0], "number");
      i += numMatch[0].length;
      continue;
    }

    const litMatch = /^(true|false|null)\b/.exec(rest);
    if (litMatch) {
      push(litMatch[0], "literal");
      i += litMatch[0].length;
      continue;
    }

    // Unknown char: accumulate one at a time until the next interesting one.
    push(ch, "text");
    i += 1;
  }

  return tokens;
}

/** Generic code fallback: strings, numbers, comments, keywords. */
export function tokenizeGeneric(text: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  // One pattern, alternation order = precedence.
  const pattern =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|([A-Za-z_$][A-Za-z0-9_$]*)|([\s\S])/g;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) tokens.push({ text: match[1], kind: "string" });
    else if (match[2]) tokens.push({ text: match[2], kind: "number" });
    else if (match[3]) tokens.push({ text: match[3], kind: "comment" });
    else if (match[4]) {
      tokens.push({ text: match[4], kind: KEYWORDS.has(match[4]) ? "key" : "text" });
    } else if (match[5]) tokens.push({ text: match[5], kind: "text" });
  }
  return tokens;
}

/**
 * Color a snippet: full JSON when it parses as a JSON document, the generic
 * tokenizer otherwise. Returns null when coloring is not worthwhile — the
 * caller renders plain text exactly as before.
 */
export function highlightCode(text: string): CodeToken[] | null {
  if (!text || text.length > CODE_HIGHLIGHT_MAX_CHARS) return null;
  if (looksLikeJson(text)) {
    try {
      JSON.parse(text);
      return tokenizeJson(text);
    } catch {
      // { starts a JS object too; fall through to the generic colorer.
      return tokenizeGeneric(text);
    }
  }
  return tokenizeGeneric(text);
}
