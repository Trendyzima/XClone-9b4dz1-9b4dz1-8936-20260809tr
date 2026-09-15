/**
 * Testagram emoji renderer inspired by Twemoji's DOM-first approach.
 *
 * We intentionally do not use innerHTML here. Text nodes are replaced in place,
 * preserving surrounding React/DOM listeners and avoiding HTML interpretation.
 * Assets are served from a configurable same-origin path so Testagram can
 * self-host/pin the artwork instead of depending on a third-party CDN.
 */
export type TestagramEmojiOptions = {
  base?: string;
  folder?: string;
  ext?: string;
  className?: string;
  size?: number | string;
  title?: boolean;
};

const DEFAULTS: Required<Omit<TestagramEmojiOptions, "title">> & { title: boolean } = {
  base: "/assets/twemoji/",
  folder: "svg",
  ext: ".svg",
  className: "testagram-emoji",
  size: "svg",
  title: false,
};

const isVariation = (codePoint: number) => codePoint === 0xfe0f || codePoint === 0xfe0e;
const isModifier = (codePoint: number) => codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
const isJoiner = (codePoint: number) => codePoint === 0x200d;

function codePointId(value: string): string {
  return Array.from(value)
    .map((char) => char.codePointAt(0)!.toString(16))
    .filter((_, index, values) => index === 0 || !isVariation(parseInt(values[index], 16)))
    .join("-");
}

function emojiSequenceAt(text: string, start: number): string | null {
  const chars = Array.from(text.slice(start));
  if (!chars.length) return null;
  const first = chars[0].codePointAt(0)!;
  if (first < 0x1f000 && first !== 0x00a9 && first !== 0x00ae && first !== 0x203c && first !== 0x2049 && first !== 0x2122) return null;

  let result = chars[0];
  let i = 1;
  while (i < chars.length) {
    const cp = chars[i].codePointAt(0)!;
    if (isVariation(cp) || isModifier(cp)) {
      result += chars[i++];
      continue;
    }
    if (isJoiner(cp) && chars[i + 1]) {
      result += chars[i++] + chars[i++];
      continue;
    }
    break;
  }
  return result;
}

function createEmojiImage(raw: string, options: typeof DEFAULTS): HTMLImageElement {
  const image = document.createElement("img");
  image.className = options.className;
  image.draggable = false;
  image.alt = raw;
  image.setAttribute("role", "img");
  if (options.title) image.title = raw;
  const folder = options.folder || String(options.size);
  image.src = `${options.base.replace(/\/$/, "")}/${folder}/${codePointId(raw)}${options.ext}`;
  return image;
}

/** Parse emoji in text nodes only. Safe for already-rendered DOM and React roots. */
export function parseTwemoji(root: HTMLElement, options: TestagramEmojiOptions = {}): void {
  if (typeof document === "undefined") return;
  const config = { ...DEFAULTS, ...options };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current.parentElement && !current.parentElement.closest("script,style,textarea,[data-no-emoji]")) nodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of nodes) {
    const text = node.nodeValue ?? "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    let changed = false;
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i++) {
      const offset = chars.slice(0, i).join("").length;
      const sequence = emojiSequenceAt(text, offset);
      if (!sequence) continue;
      const sequenceLength = sequence.length;
      const before = text.slice(cursor, offset);
      if (before) fragment.appendChild(document.createTextNode(before));
      fragment.appendChild(createEmojiImage(sequence, config));
      cursor = offset + sequenceLength;
      i += Array.from(sequence).length - 1;
      changed = true;
    }
    if (!changed) continue;
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }
}

export function emojiAssetUrl(emoji: string, options: TestagramEmojiOptions = {}): string {
  const config = { ...DEFAULTS, ...options };
  return `${config.base!.replace(/\/$/, "")}/${config.folder || String(config.size)}/${codePointId(emoji)}${config.ext}`;
}
