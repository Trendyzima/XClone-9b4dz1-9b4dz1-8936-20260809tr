import { createClient } from '@supabase/supabase-js';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Per-object safety ceiling. Media bytes go directly from the browser to R2;
// this endpoint only signs/finalizes metadata, so increasing this does not route
// large payloads through Vercel. R2 single-PUT supports up to 5 GiB.
const MAX_BYTES = 500 * 1024 * 1024;
const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska',
]);

function env(name: string, fallback = '') { return process.env[name] ?? fallback; }

function corsHeaders() {
  const origin = env('APP_ORIGIN');
  return {
    'Access-Control-Allow-Origin': origin || 'https://kooone-9b4dz1-9b4dz1-8936-20260809tr.vercel.app',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Vary': 'Origin',
  };
}

function json(res: any, status: number, body: unknown) {
  for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
  return res.status(status).json(body);
}

function extension(name: string, mime: string) {
  return name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1]
    ?? mime.split('/')[1].replace('jpeg', 'jpg').replace('quicktime', 'mov');
}

function config() {
  return {
    supabaseUrl: env('SUPABASE_URL', env('VITE_SUPABASE_URL')),
    supabaseKey: env('SUPABASE_ANON_KEY', env('VITE_SUPABASE_ANON_KEY')),
    serviceRole: env('SUPABASE_SERVICE_ROLE_KEY', env('SUPABASE_SECRET_KEY')),
    r2AccountId: env('R2_ACCOUNT_ID'),
    r2AccessKeyId: env('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    r2Bucket: env('R2_MEDIA_BUCKET', env('CLOUDFLARE_R2_BUCKET')),
    publicBaseUrl: env('R2_PUBLIC_BASE_URL').replace(/\/$/, ''),
  };
}

async function authenticate(req: any, cfg: ReturnType<typeof config>) {
  const authorization = String(req.headers.authorization ?? '');
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token || !cfg.supabaseUrl || !cfg.supabaseKey) return null;
  const client = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await client.auth.getUser(token);
  return data.user ?? null;
}

function makeR2(cfg: ReturnType<typeof config>) {
  if (!cfg.r2AccountId || !cfg.r2AccessKeyId || !cfg.r2SecretAccessKey || !cfg.r2Bucket) return null;
  return new S3Client({
    region: 'auto',
    endpoint: 'https://' + cfg.r2AccountId + '.r2.cloudflarestorage.com',
    credentials: { accessKeyId: cfg.r2AccessKeyId, secretAccessKey: cfg.r2SecretAccessKey },
  });
}

async function ownedPost(admin: any, postId: string, userId: string) {
  const { data } = await admin.from('posts').select('id,author_id,user_id').eq('id', postId).maybeSingle();
  return Boolean(data && (data.author_id === userId || data.user_id === userId));
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
    return res.status(204).end();
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const cfg = config();
  const r2 = makeR2(cfg);
  if (!r2 || !cfg.serviceRole || !cfg.supabaseUrl) {
    return json(res, 503, { error: 'Economical media backend is not configured.' });
  }

  const user = await authenticate(req, cfg);
  if (!user) return json(res, 401, { error: 'Authentication required' });

  const admin = createClient(cfg.supabaseUrl, cfg.serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = req.body ?? {};
    const action = String(body.action ?? '');

    if (action === 'init') {
      const name = String(body.name ?? '').trim();
      const mime = String(body.mime_type ?? '').trim().toLowerCase();
      const size = Number(body.size_bytes);
      const postId = body.post_id ? String(body.post_id) : null;
      const threadId = body.thread_id ? String(body.thread_id) : null;

      if (!name || name.length > 255) return json(res, 400, { error: 'Invalid file name' });
      if (!ALLOWED.has(mime)) return json(res, 415, { error: 'Unsupported media type' });
      if (!Number.isInteger(size) || size <= 0 || size > MAX_BYTES) {
        return json(res, 413, { error: 'Media must be 500 MiB or smaller' });
      }
      if (postId && !(await ownedPost(admin, postId, user.id))) {
        return json(res, 404, { error: 'Post not found or not owned by user' });
      }
      if (threadId) {
        const { data: thread } = await admin.from('threads').select('id,owner_id,deleted_at').eq('id', threadId).maybeSingle();
        if (!thread || thread.deleted_at) return json(res, 404, { error: 'Thread not found' });
      }

      const mediaType = mime.startsWith('image/') ? 'image' : 'video';
      const storageKey = 'users/' + user.id + '/' + crypto.randomUUID() + '.' + extension(name, mime);
      const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({
        Bucket: cfg.r2Bucket, Key: storageKey, ContentType: mime,
      }), { expiresIn: 900 });
      const mediaUrl = cfg.publicBaseUrl ? cfg.publicBaseUrl + '/' + storageKey : null;

      const { data, error } = await admin.from('media_assets').insert({
        owner_id: user.id, post_id: postId, thread_id: threadId, storage_key: storageKey, bucket: cfg.r2Bucket,
        original_name: name, mime_type: mime, media_type: mediaType, byte_size: size,
        status: 'pending', media_url: mediaUrl,
      }).select('id,storage_key,status,media_url,thread_id').single();

      if (error) return json(res, 500, { error: 'Unable to create media record' });
      return json(res, 200, {
        media_id: data.id, object_key: data.storage_key, upload_url: uploadUrl,
        public_url: data.media_url, expires_in: 900,
      });
    }

    if (action === 'list') {
      const prefix = `users/${user.id}/`;
      const listed = await r2.send(new ListObjectsV2Command({
        Bucket: cfg.r2Bucket,
        Prefix: prefix,
        MaxKeys: 100,
      }));
      const assets = await Promise.all((listed.Contents ?? [])
        .filter((object) => object.Key && object.Size && object.Size > 0)
        .map(async (object) => {
          const key = String(object.Key);
          const ext = key.split('.').pop()?.toLowerCase() ?? '';
          const mime = ext === 'mp4' || ext === 'mov' || ext === 'webm' || ext === 'm4v' || ext === 'ogg' ? 'video' : 'image';
          const url = await getSignedUrl(r2, new GetObjectCommand({
            Bucket: cfg.r2Bucket, Key: key,
          }), { expiresIn: 3600 });
          return {
            id: key,
            name: key.split('/').pop() ?? key,
            path: key,
            url,
            type: mime,
            size: object.Size,
            updatedAt: object.LastModified?.toISOString(),
          };
        }));
      return json(res, 200, { items: assets });
    }

    if (action === 'complete') {
      const mediaId = String(body.media_id ?? '');
      if (!mediaId) return json(res, 400, { error: 'media_id is required' });

      const { data: media, error: lookupError } = await admin.from('media_assets')
        .select('id,storage_key,bucket,byte_size,mime_type,media_type,status,media_url,post_id')
        .eq('id', mediaId).eq('owner_id', user.id).single();
      if (lookupError || !media) return json(res, 404, { error: 'Media record not found' });
      if (media.status === 'uploaded') {
        return json(res, 200, { ...media, object_key: media.storage_key, size_bytes: media.byte_size, public_url: media.media_url });
      }

      const head = await r2.send(new HeadObjectCommand({
        Bucket: media.bucket ?? cfg.r2Bucket, Key: media.storage_key,
      }));
      const actualSize = Number(head.ContentLength ?? 0);
      const actualType = String(head.ContentType ?? '').toLowerCase();

      if (actualSize <= 0 || actualSize > MAX_BYTES ||
          actualSize !== Number(media.byte_size) ||
          actualType !== String(media.mime_type).toLowerCase()) {
        await r2.send(new DeleteObjectCommand({ Bucket: media.bucket ?? cfg.r2Bucket, Key: media.storage_key }));
        await admin.from('media_assets').update({ status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', media.id).eq('owner_id', user.id);
        return json(res, 422, { error: 'Uploaded media failed size/type validation' });
      }

      const { data: updated, error } = await admin.from('media_assets')
        .update({ status: 'uploaded', etag: head.ETag ?? null, updated_at: new Date().toISOString() })
        .eq('id', media.id).eq('owner_id', user.id)
        .select('id,storage_key,post_id,byte_size,mime_type,media_type,status,media_url,etag')
        .single();
      if (error) return json(res, 500, { error: 'Unable to finalize media record' });
      const readUrl = await getSignedUrl(r2, new GetObjectCommand({
        Bucket: media.bucket ?? cfg.r2Bucket, Key: media.storage_key,
      }), { expiresIn: 24 * 60 * 60 + 15 * 60 });
      const playbackUrl = updated.media_url ?? media.media_url ?? readUrl;
      if (!updated.media_url && !media.media_url) {
        await admin.from('media_assets').update({ media_url: playbackUrl }).eq('id', media.id).eq('owner_id', user.id);
      }
      return json(res, 200, {
        ...updated, object_key: updated.storage_key, size_bytes: updated.byte_size,
        public_url: playbackUrl, expires_in: updated.media_url ? null : 24 * 60 * 60 + 15 * 60,
      });
    }

    if (action === 'attach') {
      const mediaId = String(body.media_id ?? '');
      const postId = String(body.post_id ?? '');
      if (!mediaId || !postId) return json(res, 400, { error: 'media_id and post_id are required' });
      if (!(await ownedPost(admin, postId, user.id))) return json(res, 404, { error: 'Post not found or not owned by user' });

      const { data: media } = await admin.from('media_assets')
        .select('id,status').eq('id', mediaId).eq('owner_id', user.id).single();
      if (!media) return json(res, 404, { error: 'Media record not found' });
      if (media.status !== 'uploaded') return json(res, 409, { error: 'Media is not uploaded' });

      const { data: updated, error } = await admin.from('media_assets')
        .update({ post_id: postId, updated_at: new Date().toISOString() })
        .eq('id', mediaId).eq('owner_id', user.id)
        .select('id,storage_key,post_id,media_url,media_type,mime_type,byte_size,status,etag')
        .single();
      if (error) return json(res, 500, { error: 'Unable to attach media to post' });
      return json(res, 200, {
        ...updated, object_key: updated.storage_key, public_url: updated.media_url, size_bytes: updated.byte_size,
      });
    }

    if (action === 'delete') {
      const mediaId = String(body.media_id ?? '');
      if (!mediaId) return json(res, 400, { error: 'media_id is required' });

      const { data: media } = await admin.from('media_assets')
        .select('id,storage_key,bucket').eq('id', mediaId).eq('owner_id', user.id).single();
      if (!media) return json(res, 404, { error: 'Media record not found' });

      await r2.send(new DeleteObjectCommand({
        Bucket: media.bucket ?? cfg.r2Bucket, Key: media.storage_key,
      }));
      await admin.from('media_assets').update({ status: 'deleted', updated_at: new Date().toISOString() })
        .eq('id', media.id).eq('owner_id', user.id);
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { error: 'Unknown action' });
  } catch (error) {
    console.error('api/media error', error);
    return json(res, 500, { error: 'Media operation failed' });
  }
}
