import { memo } from "react";
import { highlightCode, type CodeToken } from "../lib/codeHighlight";

/**
 * Renders a code snippet with structure colors, memo'd on the text since the
 * list can hold many code rows. Tokenized once per text: there is no reason
 * a re-render (selection change, hover) should re-parse.
 *
 * Falls back to the plain string when `highlightCode` declines — oversized
 * or unparseable content keeps exactly the rendering it had before this
 * component existed.
 */
export const CodeHighlightText = memo(function CodeHighlightText({ text }: { text: string }) {
  const tokens = highlightCode(text) as CodeToken[] | null;
  if (!tokens) return <>{text}</>;
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={`tok-${token.kind}`}>
          {token.text}
        </span>
      ))}
    </>
  );
});
