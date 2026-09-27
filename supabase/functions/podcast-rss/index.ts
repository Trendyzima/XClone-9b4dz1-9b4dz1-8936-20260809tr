import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const url = new URL(req.url);
  // Expect /podcast-rss?username=johndoe  OR  /podcast-rss/johndoe
  const username = (url.searchParams.get('username') || url.pathname.split('/').pop() || '').trim().replace(/^@/, '');
  const community = (url.searchParams.get('community') || '').trim();

  if (!username && !community) {
    return new Response('Missing username', { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Fetch user profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, username, bio, avatar_url')
    .eq('username', username)
    .maybeSingle();

  if (!profile) {
    return new Response('User not found', { status: 404 });
  }

  // Fetch their space recordings
  const { data: recordings } = await supabase
    .from('space_recordings')
    .select('*, spaces(title, description, category, artwork_url, episode_number)')
     .eq('user_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const baseUrl = Deno.env.get('SUPABASE_URL')?.replace('/v1', '') ?? 'https://testagram.site';
  const feedUrl = `${baseUrl}/functions/v1/podcast-rss?username=${username}`;
  const siteUrl = `https://testagram.site/profile/${username}`;
  const artworkUrl = profile.avatar_url ?? `${siteUrl}/app-icon.jpg`;

  const escapeXml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const formatDate = (iso: string) => new Date(iso).toUTCString();

  const items = (recordings ?? [])
    .filter((r: any) => r.audio_url)
    .map((r: any) => {
      const title = escapeXml(r.spaces?.title ?? r.title ?? 'Episode');
      const desc = escapeXml(r.spaces?.description ?? '');
      const ep = r.spaces?.episode_number ?? 1;
      const artwork = r.spaces?.artwork_url ?? artworkUrl;
      const duration = r.duration ?? 0;
      const durationStr = `${Math.floor(duration / 3600)}:${String(Math.floor((duration % 3600) / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`;

      return `
    <item>
      <title>${title}</title>
      <description>${desc}</description>
      <pubDate>${formatDate(r.created_at)}</pubDate>
      <enclosure url="${escapeXml(r.audio_url)}" length="0" type="audio/mpeg" />
      <guid isPermaLink="false">${r.id}</guid>
      <itunes:duration>${durationStr}</itunes:duration>
      <itunes:episode>${ep}</itunes:episode>
      <itunes:explicit>false</itunes:explicit>
      <itunes:image href="${escapeXml(artwork)}" />
      ${r.has_video && r.video_url ? `<itunes:title>📹 ${title}</itunes:title>` : ''}
    </item>`;
    }).join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(profile.username)} — Podcast on Testagram</title>
    <description>${escapeXml(profile.bio ?? `Listen to @${profile.username}'s podcast episodes.`)}</description>
    <link>${escapeXml(siteUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <language>en-us</language>
    <itunes:author>${escapeXml(profile.username)}</itunes:author>
    <itunes:summary>${escapeXml(profile.bio ?? `Podcast by @${profile.username} on Testagram`)}</itunes:summary>
    <itunes:image href="${escapeXml(artworkUrl)}" />
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="Technology" />
    <image>
      <url>${escapeXml(artworkUrl)}</url>
      <title>${escapeXml(profile.username)}</title>
      <link>${escapeXml(siteUrl)}</link>
    </image>
    ${items}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
