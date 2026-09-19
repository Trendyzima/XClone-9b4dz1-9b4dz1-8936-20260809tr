import { createClient } from '@supabase/supabase-js';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

function env(name: string, fallback = '') { return process.env[name] ?? fallback; }

function config() {
  return {
    supabaseUrl: env('SUPABASE_URL', env('VITE_SUPABASE_URL')),
    serviceRole: env('SUPABASE_SERVICE_ROLE_KEY', env('SUPABASE_SECRET_KEY')),
    r2AccountId: env('R2_ACCOUNT_ID'),
    r2AccessKeyId: env('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    r2Bucket: env('R2_MEDIA_BUCKET', env('CLOUDFLARE_R2_BUCKET')),
    cronSecret: env('CRON_SECRET'),
  };
}

export default async function handler(req: any, res: any) {
  const cfg = config();
  const authorization = String(req.headers.authorization ?? '');
  if (!cfg.cronSecret || authorization !== `Bearer ${cfg.cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!cfg.supabaseUrl || !cfg.serviceRole || !cfg.r2AccountId || !cfg.r2AccessKeyId || !cfg.r2SecretAccessKey || !cfg.r2Bucket) {
    return res.status(503).json({ error: 'Story cleanup backend is not configured' });
  }

  const db = createClient(cfg.supabaseUrl, cfg.serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.r2AccessKeyId, secretAccessKey: cfg.r2SecretAccessKey },
  });

  try {
    const { data: rows, error } = await db
      .from('stories')
      .select('id, batch_id, media_asset_id, expires_at, media_assets(id, storage_key, bucket, status)')
      .lte('expires_at', new Date().toISOString())
      .is('deleted_at', null)
      .limit(500);

    if (error) throw error;

    let deletedObjects = 0;
    let cleanedStories = 0;
    const batchIds = new Set<string>();

    for (const row of rows ?? []) {
      const asset = Array.isArray(row.media_assets) ? row.media_assets[0] : row.media_assets;
      if (asset?.storage_key && asset.status !== 'deleted') {
        try {
          await r2.send(new DeleteObjectCommand({
            Bucket: asset.bucket || cfg.r2Bucket,
            Key: asset.storage_key,
          }));
          deletedObjects += 1;
        } catch (objectError) {
          console.error('R2 story cleanup failed', row.id, objectError);
          continue;
        }

        await db.from('media_assets')
          .update({ status: 'deleted', updated_at: new Date().toISOString() })
          .eq('id', asset.id);
      }

      await db.from('stories')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('deleted_at', null);

      if (row.batch_id) batchIds.add(row.batch_id);
      cleanedStories += 1;
    }

    if (batchIds.size > 0) {
      await db.from('story_batches')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', Array.from(batchIds))
        .is('deleted_at', null);
    }

    // Remove abandoned direct uploads so users who select files and close the
    // composer do not accumulate permanent R2 objects or media rows.
    const orphanCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: orphanAssets } = await db
      .from('media_assets')
      .select('id, storage_key, bucket, status')
      .is('post_id', null)
      .lt('created_at', orphanCutoff)
      .in('status', ['pending', 'uploaded'])
      .limit(500);

    let deletedOrphans = 0;
    for (const asset of orphanAssets ?? []) {
      const { count: storyRefs } = await db
        .from('stories')
        .select('id', { count: 'exact', head: true })
        .eq('media_asset_id', asset.id)
        .is('deleted_at', null);
      if ((storyRefs ?? 0) > 0) continue;

      try {
        if (asset.storage_key) {
          await r2.send(new DeleteObjectCommand({
            Bucket: asset.bucket || cfg.r2Bucket,
            Key: asset.storage_key,
          }));
        }
        await db.from('media_assets')
          .update({ status: 'deleted', updated_at: new Date().toISOString() })
          .eq('id', asset.id);
        deletedOrphans += 1;
      } catch (orphanError) {
        console.error('R2 orphan cleanup failed', asset.id, orphanError);
      }
    }

    return res.status(200).json({
      ok: true,
      scanned: rows?.length ?? 0,
      deleted_objects: deletedObjects,
      cleaned_stories: cleanedStories,
      cleaned_batches: batchIds.size,
      deleted_orphans: deletedOrphans,
    });
  } catch (error) {
    console.error('story-cleanup error', error);
    return res.status(500).json({ error: 'Story cleanup failed' });
  }
}
