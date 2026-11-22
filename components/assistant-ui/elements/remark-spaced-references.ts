import type { Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

// Markdown.tw allows a space between the caption and its reference label.
// Let the parser identify actual references so code, HTML and escapes stay literal.
export const remarkSpacedReferences: Plugin<[], Root> = function () {
  return (tree, file) => {
    const source = String(file);
    if (!/\][ \t]+\[/.test(source)) return tree;

    const gaps = new Map<number, number>();
    let removed = 0;
    const compact = source.replace(/\]([ \t]+)(?=\[)/g, (_, space: string, offset: number) => {
      const start = offset + 1;
      gaps.set(start - removed, start);
      removed += space.length;
      return "]";
    });

    const parsed = this.parse(compact) as Root;
    const accepted = new Set<number>();
    visit(parsed, (node) => {
      if (node.type !== "linkReference" && node.type !== "imageReference") return;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined || node.referenceType === "shortcut") return;
      const label = /\]\[(?:\\.|[^\]\\[])*\]$/.exec(compact.slice(start, end));
      const gap = label && gaps.get(start + label.index + 1);
      if (typeof gap === "number") accepted.add(gap);
    });

    if (!accepted.size) return tree;
    if (accepted.size === gaps.size) return parsed;
    const normalized = source.replace(/\]([ \t]+)(?=\[)/g, (match, _space, offset: number) =>
      accepted.has(offset + 1) ? "]" : match,
    );
    return this.parse(normalized) as Root;
  };
};
