import { Fragment, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

type FediverseTag = {
  type?: string;
  name?: string;
  href?: string;
};

type Props = {
  html?: string | null;
  tags?: FediverseTag[];
  className?: string;
};

/**
 * Render ActivityPub/Mastodon HTML as Testagram-native social text.
 *
 * Remote servers normally provide sanitized HTML and semantic tag metadata.
 * We keep ordinary links external, but route hashtags into Testagram's
 * canonical hashtag surface and remote mentions into the Fediverse profile
 * surface. No remote HTML is injected with dangerouslySetInnerHTML.
 */
export function FediverseRichText({ html, tags = [], className }: Props) {
  const navigate = useNavigate();

  const tagByName = new Map<string, FediverseTag>();
  for (const tag of Array.isArray(tags) ? tags : []) {
    const name = String(tag?.name ?? '').trim().toLowerCase();
    if (name) tagByName.set(name.replace(/^[@#]+/, ''), tag);
  }

  const routeHashtag = (raw: string) => {
    const clean = raw.replace(/^#/, '').trim().toLowerCase();
    if (!clean) return;
    navigate('/hashtag/' + encodeURIComponent(clean));
  };

  const routeMention = (raw: string, href?: string) => {
    const clean = raw.replace(/^@/, '').trim();
    if (!clean) return;
    const remote = clean.includes('@');
    if (remote) {
      const [username, domain] = clean.split('@', 2);
      const actor = href && /^https?:\/\//i.test(href) ? href : 'https://' + domain + '/@' + username;
      navigate('/fediverse/profile?actor=' + encodeURIComponent(actor) + '&handle=' + encodeURIComponent(username + '@' + domain));
      return;
    }
    if (href && /^https?:\/\//i.test(href)) {
      let host = '';
      try { host = new URL(href).hostname; } catch {}
      if (host) {
        navigate('/fediverse/profile?actor=' + encodeURIComponent(href) + '&handle=' + encodeURIComponent(clean + '@' + host));
        return;
      }
    }
    navigate('/profile/' + encodeURIComponent(clean));
  };

  const tokenizeText = (text: string, keyPrefix: string): ReactNode[] => {
    const nodes: ReactNode[] = [];
    const re = /(^|[^#\w])(#(?:[\p{L}\p{N}_-]{1,64}))(?![\w-])|(^|[^@\w])(@(?:[\w.-]+@[A-Za-z0-9.-]+|[\w.-]{1,64}))(?![\w.-])/gu;
    let last = 0;
    let index = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const token = match[2] ?? match[4];
      const start = (match.index + (match[2] ? match[1].length : match[3].length));
      if (start > last) nodes.push(text.slice(last, start));
      if (match[2]) {
        const clean = token.slice(1).toLowerCase();
        nodes.push(
          <button key={keyPrefix + '-h-' + index++} type="button" onClick={() => routeHashtag(clean)}
            className="text-primary font-semibold hover:underline">
            #{clean}
          </button>
        );
      } else {
        const mention = token;
        const explicit = mention.slice(1);
        const metadata = tagByName.get(explicit.toLowerCase());
        nodes.push(
          <button key={keyPrefix + '-m-' + index++} type="button" onClick={() => routeMention(mention, metadata?.href)}
            className="text-primary font-semibold hover:underline">
            {mention}
          </button>
        );
      }
      last = re.lastIndex;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
  };

  const renderNode = (node: Node, key: string): ReactNode => {
    if (node.nodeType === Node.TEXT_NODE) {
      return <Fragment key={key}>{tokenizeText(node.textContent ?? '', key)}</Fragment>;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'img') return null;

    const children = Array.from(el.childNodes).map((child, i) => renderNode(child, key + '-' + i));
    if (tag === 'br') return <br key={key} />;
    if (tag === 'p') return <p key={key} className="mb-3 last:mb-0">{children}</p>;
    if (tag === 'strong' || tag === 'b') return <strong key={key}>{children}</strong>;
    if (tag === 'em' || tag === 'i') return <em key={key}>{children}</em>;
    if (tag === 'u') return <u key={key}>{children}</u>;
    if (tag === 'del') return <del key={key}>{children}</del>;
    if (tag === 'blockquote') return <blockquote key={key} className="border-l-4 border-primary/30 pl-3 italic">{children}</blockquote>;
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      const text = el.textContent?.trim() ?? '';
      const isHashtag = el.classList.contains('hashtag') || /^#/.test(text) || /\/tags\//i.test(href);
      const isMention = el.classList.contains('mention') || /^@/.test(text);
      if (isHashtag) {
        const clean = (text.match(/#([\p{L}\p{N}_-]{1,64})/u)?.[1] ?? text.replace(/^#/, '')).toLowerCase();
        return <button key={key} type="button" onClick={() => routeHashtag(clean)} className="text-primary font-semibold hover:underline">#{clean}</button>;
      }
      if (isMention) {
        const clean = text || '@mention';
        return <button key={key} type="button" onClick={() => routeMention(clean, href)} className="text-primary font-semibold hover:underline">{children}</button>;
      }
      if (/^https?:\/\//i.test(href)) {
        return <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">{children}</a>;
      }
      return <Fragment key={key}>{children}</Fragment>;
    }
    if (tag === 'span') return <span key={key}>{children}</span>;
    if (tag === 'code') return <code key={key}>{children}</code>;
    if (tag === 'pre') return <pre key={key} className="overflow-x-auto">{children}</pre>;
    if (tag === 'li') return <li key={key}>{children}</li>;
    if (tag === 'ul') return <ul key={key} className="list-disc pl-5">{children}</ul>;
    if (tag === 'ol') return <ol key={key} className="list-decimal pl-5">{children}</ol>;
    return <Fragment key={key}>{children}</Fragment>;
  };

  const source = String(html ?? '');
  if (!source) return null;

  if (typeof DOMParser === 'undefined') {
    return <div className={className}>{tokenizeText(source, 'fallback')}</div>;
  }

  try {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    doc.querySelectorAll('script,style,noscript,img,iframe,object,embed,form,input,button').forEach(n => n.remove());
    return <div className={className}>{Array.from(doc.body.childNodes).map((node, i) => renderNode(node, 'node-' + i))}</div>;
  } catch {
    return <div className={className}>{tokenizeText(source.replace(/<[^>]*>/g, ' '), 'fallback')}</div>;
  }
}
