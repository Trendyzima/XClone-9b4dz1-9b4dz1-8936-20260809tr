import { clsx, ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
}

export function localizeSocialLinks(content: string): string {
  // ActivityPub HTML deliberately uses canonical URLs from the source instance.
  // Those URLs must never become browser-level navigation targets in Testagram.
  // Mentions stay inside Testagram and retain the canonical actor URL as a query
  // parameter so the Fediverse profile page can resolve the exact remote actor.
  return content.replace(/<a\b([^>]*)\bhref=(['"])(https?:\/\/[^'"]+)\2([^>]*)>([\s\S]*?)<\/a>/gi, (match, before, quote, href, after, label) => {
    const text = String(label).replace(/<[^>]*>/g, '').trim();
    const token = text.match(/^([@#])([^\s<]+)/);
    if (!token) return match;

    const kind = token[1];
    const rawValue = token[2].replace(/^@/, '').replace(/^#/, '');
    if (!rawValue) return match;

    if (kind === '#') {
      const localHref = '/hashtag/' + encodeURIComponent(rawValue.toLowerCase());
      return '<a href="' + localHref + '" class="text-primary hover:underline">' + label + '</a>';
    }

    const actor = href;
    let host = '';
    try { host = new URL(actor).hostname; } catch { return match; }
    const username = rawValue.split('@')[0];
    const handle = username + '@' + host;
    const localHref = '/fediverse/profile?actor=' + encodeURIComponent(actor) + '&handle=' + encodeURIComponent(handle);
    return '<a href="' + localHref + '" class="text-primary hover:underline">' + label + '</a>';
  });
}
export function parseContent(content: string): string {
  const processInline = (text: string) =>
    text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');

  const lines = content.split('\n');
  const htmlParts: string[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      htmlParts.push(`<p class="mb-3 leading-relaxed">${paragraphLines.map(processInline).join('<br />')}</p>`);
      paragraphLines = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushParagraph(); continue; }

    if (line.startsWith('## ')) {
      flushParagraph();
      const text = line.slice(3).trim();
      const id = `ch-${text.toLowerCase().replace(/[^a-z0-9\s]+/g, '').replace(/\s+/g, '-').slice(0, 40)}`;
      htmlParts.push(`<h2 id="${id}" class="text-xl font-bold mt-8 mb-3 scroll-mt-24">${processInline(text)}</h2>`);
      continue;
    }
    if (line.startsWith('# ')) {
      flushParagraph();
      htmlParts.push(`<h1 class="text-2xl font-bold mt-8 mb-3">${processInline(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith('### ')) {
      flushParagraph();
      htmlParts.push(`<h3 class="text-lg font-semibold mt-5 mb-2">${processInline(line.slice(4))}</h3>`);
      continue;
    }
    if (line === '---') {
      flushParagraph();
      htmlParts.push('<hr class="border-border my-6" />');
      continue;
    }
    if (line.startsWith('> ')) {
      flushParagraph();
      htmlParts.push(`<blockquote class="border-l-4 border-primary/40 pl-4 italic text-muted-foreground my-3">${processInline(line.slice(2))}</blockquote>`);
      continue;
    }
    if (line.startsWith('\u2022 ') || line.startsWith('- ')) {
      flushParagraph();
      htmlParts.push(`<div class="flex gap-2 mb-1"><span class="text-primary shrink-0 mt-0.5">\u2022</span><span>${processInline(line.slice(2))}</span></div>`);
      continue;
    }

    paragraphLines.push(line);
  }
  flushParagraph();

  let parsed = htmlParts.join('');

  // Normalize any pre-existing remote hashtag/mention anchors before creating local links.
  parsed = localizeSocialLinks(parsed);

  // Linkify hashtags — skip occurrences already inside HTML attributes (href/id/class)
  // Two-step: protect attributes, then replace bare #word tokens in text
  parsed = parsed.replace(/(<[^>]+>)|#(\w+)/g, (m, tag, hash) => {
    if (tag) return tag; // keep HTML tags unchanged
    return `<a href="/hashtag/${hash}" class="text-primary hover:underline">#${hash}</a>`;
  });

  // Linkify remote @user@instance mentions before local @user mentions.
  // Remote mentions must remain inside Testagram while preserving their actor identity.
  parsed = parsed.replace(/(<[^>]+>)|@(\\w+)@([A-Za-z0-9.-]+)(?=\\s|$|[.,!?;:])/g, (m, tag, username, domain) => {
    if (tag) return tag;
    const actor = 'https://' + domain + '/@' + username;
    const handle = username + '@' + domain;
    const href = '/fediverse/profile?actor=' + encodeURIComponent(actor) + '&handle=' + encodeURIComponent(handle);
    return '<a href="' + href + '" class="text-primary hover:underline">@' + username + '@' + domain + '</a>';
  });

  // Linkify local @mentions — same protection pattern.
  parsed = parsed.replace(/(<[^>]+>)|@(\\w+)/g, (m, tag, mention) => {
    if (tag) return tag;
    return `<a href="/profile/${mention}" class="text-primary hover:underline">@${mention}</a>`;
  });

  // Linkify bare URLs — skip ones already inside href attributes
  parsed = parsed.replace(/(<[^>]+>)|(https?:\/\/[^\s<"]+)/g, (m, tag, url) => {
    if (tag) return tag;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline break-all">${url}</a>`;
  });

  return parsed;
}

export function extractHashtags(content: string): string[] {
  const matches = content.match(/#(\w+)/g);
  return matches ? matches.map(tag => tag.substring(1).toLowerCase()) : [];
}

export function extractMentions(content: string): string[] {
  const matches = content.match(/@(\w+)/g);
  return matches ? matches.map(mention => mention.substring(1).toLowerCase()) : [];
}

export function generateShareablePostUrl(postId: string): string {
  const baseUrl = window.location.origin;
  return `${baseUrl}/post/${postId}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
