import { useEffect } from 'react';
// useSEO — Dynamic per-page SEO meta tag manager
// Injects/updates <title>, Open Graph, Twitter Card, canonical URL,
// and JSON-LD structured data into the document <head>.
// All changes are reversible: the hook removes tags it added on unmount
// so navigating away restores the global defaults from index.html.

export interface SEOProps {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'profile' | 'video.other';
  /** Raw JSON-LD object(s) to inject as structured data */
  structuredData?: object | object[];
  /** Noindex this page (auth pages, private routes, etc.) */
  noindex?: boolean;
  keywords?: string;
}

const BASE_URL = 'https://testagram.site';
const OG_IMAGE_BASE = 'https://lrqqpudyrkmitbeilrqq.backend.onspace.ai/functions/v1/og-image';
const DEFAULT_IMAGE = `${BASE_URL}/og-image.jpg`;
const SITE_NAME = 'Testagram';

export function buildOgImageUrl(params: { username?: string; thread?: string; community?: string; tag?: string; post?: string }): string {
  const p = new URLSearchParams();
  if (params.username) p.set('username', params.username);
  else if (params.thread) p.set('thread', params.thread);
  else if (params.community) p.set('community', params.community);
  else if (params.tag) p.set('tag', params.tag);
  else if (params.post) p.set('post', params.post);
  return `${OG_IMAGE_BASE}?${p.toString()}`;
}

function setMeta(attr: 'name' | 'property', key: string, value: string): HTMLMetaElement {
  let el = document.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
    el.dataset.seoManaged = '1';
  }
  el.setAttribute('content', value);
  return el;
}

function setLink(rel: string, href: string): HTMLLinkElement {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  const wasExisting = !!el;
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  if (!wasExisting) el.dataset.seoManaged = '1';
  el.setAttribute('href', href);
  return el;
}

function addJsonLd(data: object): HTMLScriptElement {
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  script.dataset.seoManaged = '1';
  document.head.appendChild(script);
  return script;
}

export function useSEO({ title, description, image, url, type = 'website', structuredData, noindex = false, keywords }: SEOProps) {
  useEffect(() => {
    const prevTitle = document.title;
    const managedEls: Array<HTMLElement> = [];
    const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} – Social Media, Short Videos & Global Conversations`;
    const fullDesc = description || 'Post short videos, join communities, earn from your content, and connect with people worldwide on Testagram.';
    const fullImage = image || DEFAULT_IMAGE;
    const fullUrl = url ? (url.startsWith('http') ? url : `${BASE_URL}${url}`) : BASE_URL;
    const robots = noindex ? 'noindex, nofollow' : 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1';
    document.title = fullTitle;
    managedEls.push(setMeta('name', 'description', fullDesc));
    managedEls.push(setMeta('name', 'robots', robots));
    if (keywords) managedEls.push(setMeta('name', 'keywords', keywords));
    managedEls.push(setLink('canonical', fullUrl));
    managedEls.push(setMeta('property', 'og:type', type));
    managedEls.push(setMeta('property', 'og:url', fullUrl));
    managedEls.push(setMeta('property', 'og:title', fullTitle));
    managedEls.push(setMeta('property', 'og:description', fullDesc));
    managedEls.push(setMeta('property', 'og:image', fullImage));
    managedEls.push(setMeta('property', 'og:image:width', '1200'));
    managedEls.push(setMeta('property', 'og:image:height', '630'));
    managedEls.push(setMeta('property', 'og:site_name', SITE_NAME));
    managedEls.push(setMeta('name', 'twitter:card', 'summary_large_image'));
    managedEls.push(setMeta('name', 'twitter:site', '@testagram'));
    managedEls.push(setMeta('name', 'twitter:url', fullUrl));
    managedEls.push(setMeta('name', 'twitter:title', fullTitle));
    managedEls.push(setMeta('name', 'twitter:description', fullDesc));
    managedEls.push(setMeta('name', 'twitter:image', fullImage));
    const ldScripts: HTMLScriptElement[] = [];
    if (structuredData) {
      const items = Array.isArray(structuredData) ? structuredData : [structuredData];
      items.forEach(item => { const script = addJsonLd(item); ldScripts.push(script); managedEls.push(script); });
    }
    return () => {
      document.title = prevTitle;
      managedEls.forEach(el => { if (el.dataset?.seoManaged === '1') el.parentNode?.removeChild(el); });
    };
  }, [title, description, image, url, type, noindex, keywords, structuredData]);
}

export function buildProfileLD(profile: { username: string; bio?: string; avatar_url?: string; follower_count?: number; verified?: boolean }) {
  return { '@context': 'https://schema.org', '@type': 'Person', name: profile.username, alternateName: `@${profile.username}`, description: profile.bio || '', image: profile.avatar_url || '', url: `https://testagram.site/profile/${profile.username}`, interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/FollowAction', userInteractionCount: profile.follower_count ?? 0 }, ...(profile.verified ? { award: 'Verified Creator' } : {}) };
}

export function buildPostLD(post: { id: string; content: string; image_url?: string; video_url?: string; created_at: string; user_profiles?: { username?: string; avatar_url?: string } }) {
  const base = { '@context': 'https://schema.org', '@type': post.video_url ? 'VideoObject' : 'SocialMediaPosting', url: `https://testagram.site/post/${post.id}`, datePublished: post.created_at, author: { '@type': 'Person', name: post.user_profiles?.username ?? 'Unknown', url: post.user_profiles?.username ? `https://testagram.site/profile/${post.user_profiles.username}` : 'https://testagram.site' }, publisher: { '@type': 'Organization', name: 'Testagram', logo: { '@type': 'ImageObject', url: 'https://testagram.site/tsocial-logo.png' } } };
  if (post.video_url) return { ...base, name: post.content.slice(0, 100), description: post.content.slice(0, 200), contentUrl: post.video_url, thumbnailUrl: post.image_url || 'https://testagram.site/og-image.jpg' };
  return { ...base, headline: post.content.slice(0, 110), articleBody: post.content, image: post.image_url || 'https://testagram.site/og-image.jpg' };
}

export function buildThreadLD(thread: { id: string; title: string; content: string; cover_image?: string; media_url?: string; created_at: string; updated_at?: string; user_id?: string; views_count?: number; likes_count?: number; user_profiles?: { username?: string; avatar_url?: string; verified?: boolean } }) {
  const author = thread.user_profiles?.username ? { '@type': 'Person', name: thread.user_profiles.username, url: `https://testagram.site/profile/${thread.user_profiles.username}`, ...(thread.user_profiles.avatar_url ? { image: thread.user_profiles.avatar_url } : {}) } : { '@type': 'Organization', name: 'Testagram', url: 'https://testagram.site' };
  const plainText = thread.content.replace(/<[^>]*>/g, '');
  const wordCount = plainText.trim().split(/\s+/).filter(Boolean).length;
  return { '@context': 'https://schema.org', '@type': 'Article', headline: thread.title.slice(0, 110), description: plainText.slice(0, 200), articleBody: plainText.slice(0, 1000), wordCount, url: `https://testagram.site/thread/${thread.id}`, mainEntityOfPage: { '@type': 'WebPage', '@id': `https://testagram.site/thread/${thread.id}` }, datePublished: thread.created_at, dateModified: thread.updated_at || thread.created_at, author, image: thread.cover_image || thread.media_url || 'https://testagram.site/og-image.jpg', publisher: { '@type': 'Organization', name: 'Testagram', logo: { '@type': 'ImageObject', url: 'https://testagram.site/tsocial-logo.png' } }, interactionStatistic: [{ '@type': 'InteractionCounter', interactionType: 'https://schema.org/ViewAction', userInteractionCount: thread.views_count ?? 0 }, { '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: thread.likes_count ?? 0 }] };
}

export function buildCommunityLD(community: { name: string; display_name: string; description?: string; icon_url?: string; member_count?: number }) {
  return { '@context': 'https://schema.org', '@type': 'Organization', name: community.display_name, alternateName: `c/${community.name}`, description: community.description || '', url: `https://testagram.site/c/${community.name}`, logo: community.icon_url || 'https://testagram.site/tsocial-logo.png', numberOfEmployees: { '@type': 'QuantitativeValue', value: community.member_count ?? 0 } };
}

export function buildHashtagLD(tag: string, postCount: number) {
  return { '@context': 'https://schema.org', '@type': 'WebPage', name: `#${tag} on Testagram`, description: `Browse ${postCount.toLocaleString()} posts tagged with #${tag} on Testagram.`, url: `https://testagram.site/hashtag/${tag}`, breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: 'https://testagram.site' }, { '@type': 'ListItem', position: 2, name: `#${tag}`, item: `https://testagram.site/hashtag/${tag}` }] } };
}
