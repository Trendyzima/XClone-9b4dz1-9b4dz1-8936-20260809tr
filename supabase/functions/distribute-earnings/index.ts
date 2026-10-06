import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, accept, x-request-id', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS' };

// ── CPM Rate Tiers (creator share per 1,000 views) ─────────────────────────
// Tier is determined by: verified status + cumulative video views
// Standard   : $1.50/1k  → default, new creators
// Rising      : $2.00/1k  → unverified with 10k+ total video views
// Premium     : $2.50/1k  → verified creators
// Top Creator : $3.50/1k  → verified + 100k+ total video views
const CPM_TIERS = {
  top_creator: 0.0035,   // $3.50 per 1k views
  premium:     0.0025,   // $2.50 per 1k views
  rising:      0.0020,   // $2.00 per 1k views
  standard:    0.0015,   // $1.50 per 1k views
} as const;

type Tier = keyof typeof CPM_TIERS;

function getCpmTier(verified: boolean, totalViews: number): Tier {
  if (verified && totalViews >= 100_000) return 'top_creator';
  if (verified)                          return 'premium';
  if (totalViews >= 10_000)             return 'rising';
  return 'standard';
}

const AD_REVENUE_SHARE = 0.40; // Creator gets 40% of platform ad revenue attribution (platform keeps 60%)

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const results = {
      videoFund:     0,
      adRevenue:     0,
      subscriptions: 0,
      ratesUpdated:  0,
      errors:        [] as string[],
    };

    // ── 1. Update per-creator CPM tiers ───────────────────────────────────
    // Fetch all video creators with their total views and verified status
    const { data: creatorStats } = await supabase
      .from('user_profiles')
      .select('id, verified, followers_count')
      .eq('is_creator', true);

    const creatorIds = (creatorStats ?? []).map((c: any) => c.id);

    // Get total video views per creator
    const { data: videoPosts } = await supabase
      .from('posts')
      .select('user_id, views_count')
      .eq('is_video', true)
      .in('user_id', creatorIds);

    const viewsByCreator: Record<string, number> = {};
    (videoPosts ?? []).forEach((p: any) => {
      viewsByCreator[p.user_id] = (viewsByCreator[p.user_id] ?? 0) + (p.views_count ?? 0);
    });

    for (const creator of (creatorStats ?? [])) {
      const totalViews = viewsByCreator[creator.id] ?? 0;
      const tier       = getCpmTier(creator.verified, totalViews);
      const cpm        = CPM_TIERS[tier] * 1000; // as $/1k

      // Detect tier upgrades before upserting
      const { data: existingRate } = await supabase
        .from('video_revenue_rates')
        .select('tier, cpm_usd')
        .eq('user_id', creator.id)
        .maybeSingle();
      const oldTier = existingRate?.tier as Tier | null;

      await supabase.from('video_revenue_rates').upsert({
        user_id:      creator.id,
        tier,
        cpm_usd:      cpm,
        period_views: totalViews,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'user_id' });

      // Fire platform_inbox notification on tier upgrade
      if (oldTier && oldTier !== tier && CPM_TIERS[tier] > CPM_TIERS[oldTier]) {
        const cpmGain    = (CPM_TIERS[tier] - CPM_TIERS[oldTier]) * 1000;
        const revenueGain = totalViews >= 1000
          ? ` That's an extra $${((CPM_TIERS[tier] - CPM_TIERS[oldTier]) * totalViews).toFixed(2)} on your current ${totalViews.toLocaleString()} views.`
          : '';
        const tierEmoji: Record<string, string> = {
          top_creator: '\uD83D\uDC51', premium: '\u2B50', rising: '\uD83D\uDCC8', standard: '\uD83C\uDF31',
        };
        await supabase.from('platform_inbox').insert({
          user_id:    creator.id,
          subject:    `${tierEmoji[tier] ?? '\uD83C\uDF1F'} Revenue Tier Upgrade: ${tier.replace(/_/g, ' ')}!`,
          body:       `Your revenue tier upgraded from ${oldTier.replace(/_/g, ' ')} \u2192 ${tier.replace(/_/g, ' ')}. New CPM rate: $${(CPM_TIERS[tier] * 1000).toFixed(2)}/1k views (+$${cpmGain.toFixed(2)} more per 1k).${revenueGain} Daily payouts are applied automatically at midnight.`,
          type:       'update',
          icon_emoji: tierEmoji[tier] ?? '\uD83C\uDF1F',
          cta_label:  'View Revenue Rates',
          cta_url:    '/monetization',
        }).catch(() => {});
        console.log(`Tier upgrade: user=${creator.id} ${oldTier} \u2192 ${tier} (+$${cpmGain.toFixed(2)}/1k)`);
      }

      results.ratesUpdated++;
    }

    // ── 2. Video Creator Fund (tiered CPM) ────────────────────────────────
    // Pay creators for videos with 1,000+ views not yet paid
    const { data: unpaidVideos, error: videosErr } = await supabase
      .from('posts')
      .select('id, user_id, views_count')
      .eq('is_video', true)
      .eq('fund_earnings_paid', false)
      .gte('views_count', 1000);

    if (videosErr) {
      results.errors.push(`videos: ${videosErr.message}`);
    } else {
      // Build a lookup of creator tiers for efficient access
      const tierMap: Record<string, Tier> = {};
      (creatorStats ?? []).forEach((c: any) => {
        const totalViews = viewsByCreator[c.id] ?? 0;
        tierMap[c.id] = getCpmTier(c.verified, totalViews); // fixed: use c.id not c.user_id
      });

      for (const video of (unpaidVideos ?? [])) {
        const thousands = Math.floor(video.views_count / 1000);
        const tier      = tierMap[video.user_id] ?? 'standard';
        const cpmRate   = CPM_TIERS[tier];
        const earned    = thousands * cpmRate * 1000;
        if (earned <= 0) continue;

        const { error: earningErr } = await supabase.from('creator_earnings').insert({
          user_id: video.user_id,
          source:  'video_fund',
          amount:  earned,
          post_id: video.id,
          status:  'completed',
        });
        if (earningErr) { results.errors.push(`earning ${video.id}: ${earningErr.message}`); continue; }

        const { data: walletCredit, error: walletErr } = await supabase.rpc('credit_creator_earning_to_wallet', {
          p_creator_id: video.user_id,
          p_amount: earned,
          p_currency: 'KES',
          p_reference_type: 'video_fund',
          p_reference_id: video.id,
          p_idempotency_key: `video-fund:${video.id}`,
          p_description: 'Video creator fund earnings',
        });
        if (walletErr || !walletCredit?.ok) {
          results.errors.push(`canonical wallet ${video.id}: ${walletErr?.message || 'credit failed'}`);
          continue;
        }
        await supabase.from('creator_earnings').update({ wallet_credited: true }).eq('user_id', video.user_id).eq('post_id', video.id).eq('wallet_credited', false);

        // Track platform vs creator split in revenue_shares (60% platform / 40% creator for video fund)
        const platformCut = parseFloat((earned * 0.60).toFixed(6));
        const creatorCut  = parseFloat((earned * 0.40).toFixed(6));
        await supabase.from('revenue_shares').upsert({
          user_id:         video.user_id,
          total_revenue:   earned,
          platform_share:  platformCut,
          user_share:      creatorCut,
          paid_to_platform: platformCut,
          paid_to_user:    earned, // full earned credited to creator wallet
        }, { onConflict: 'user_id' }).then(({ error: rsErr }) => {
          if (!rsErr) return;
          // On conflict, update incrementally
          return supabase.from('revenue_shares').select('total_revenue,platform_share,user_share,paid_to_platform,paid_to_user').eq('user_id', video.user_id).maybeSingle().then(({ data }) => {
            if (!data) return;
            return supabase.from('revenue_shares').update({
              total_revenue:    parseFloat((Number(data.total_revenue) + earned).toFixed(6)),
              platform_share:   parseFloat((Number(data.platform_share) + platformCut).toFixed(6)),
              user_share:       parseFloat((Number(data.user_share) + creatorCut).toFixed(6)),
              paid_to_platform: parseFloat((Number(data.paid_to_platform) + platformCut).toFixed(6)),
              paid_to_user:     parseFloat((Number(data.paid_to_user) + earned).toFixed(6)),
              updated_at:       new Date().toISOString(),
            }).eq('user_id', video.user_id);
          });
        });

        // Mark as paid + update period revenue in rates table
        await supabase.from('posts').update({ fund_earnings_paid: true }).eq('id', video.id);
        // Update period_revenue atomically via read-then-write
        await supabase.from('video_revenue_rates')
          .select('period_revenue').eq('user_id', video.user_id).maybeSingle()
          .then(({ data }) => {
            const cur = Number(data?.period_revenue ?? 0);
            return supabase.from('video_revenue_rates')
              .update({ period_revenue: parseFloat((cur + earned).toFixed(6)) })
              .eq('user_id', video.user_id);
          });

        results.videoFund += earned;
        console.log(`Video fund [${tier}] $${(cpmRate * 1000).toFixed(2)}/1k: user=${video.user_id} video=${video.id} earned=$${earned.toFixed(4)} views=${video.views_count}`);
      }
    }

    // ── 3. Ad Revenue Distribution ────────────────────────────────────────
    const thisMonth = new Date();
    thisMonth.setDate(1); thisMonth.setHours(0, 0, 0, 0);

    const { data: monetizedCreators } = await supabase
      .from('user_monetization')
      .select('user_id, revenue_share_percentage')
      .eq('is_monetized', true)
      .gt('total_views', 0);

    if (monetizedCreators && monetizedCreators.length > 0) {
      const mCreatorIds = monetizedCreators.map((c: any) => c.user_id);
      const { data: monthViewData } = await supabase
        .from('posts')
        .select('user_id, views_count')
        .in('user_id', mCreatorIds)
        .gte('created_at', thisMonth.toISOString());

      const monthViewsByCreator: Record<string, number> = {};
      (monthViewData ?? []).forEach((p: any) => {
        monthViewsByCreator[p.user_id] = (monthViewsByCreator[p.user_id] ?? 0) + (p.views_count ?? 0);
      });
      const totalMonthViews = Object.values(monthViewsByCreator).reduce((s, v) => s + v, 0);

      const { data: adPlacements } = await supabase
        .from('ad_placements')
        .select('revenue')
        .gte('created_at', thisMonth.toISOString());
      const platformAdRevenue = (adPlacements ?? []).reduce((s: number, a: any) => s + Number(a.revenue), 0);
      const toDistribute = platformAdRevenue * AD_REVENUE_SHARE;

      if (toDistribute > 0.01 && totalMonthViews > 0) {
        for (const [creatorId, views] of Object.entries(monthViewsByCreator)) {
          if (views === 0) continue;
          const share = (views / totalMonthViews) * toDistribute;
          if (share < 0.001) continue;

          const { data: existing } = await supabase
            .from('creator_earnings')
            .select('id').eq('user_id', creatorId).eq('source', 'ad_revenue_share')
            .gte('created_at', thisMonth.toISOString()).limit(1).maybeSingle();
          if (existing) continue;

          const { data: adEarning, error: adEarningErr } = await supabase.from('creator_earnings').insert({
            user_id: creatorId, source: 'ad_revenue_share', amount: share, status: 'completed',
          }).select('id').single();
          if (adEarningErr) {
            results.errors.push(`ad earning ${creatorId}: ${adEarningErr.message}`);
            continue;
          }
          const { data: adWalletCredit, error: adWalletErr } = await supabase.rpc('credit_creator_earning_to_wallet', {
            p_creator_id: creatorId,
            p_amount: share,
            p_currency: 'KES',
            p_reference_type: 'ad_revenue_share',
            p_reference_id: adEarning.id,
            p_idempotency_key: `ad-revenue:${adEarning.id}`,
            p_description: 'Creator advertising revenue share',
          });
          if (adWalletErr || !adWalletCredit?.ok) {
            results.errors.push(`canonical ad wallet ${creatorId}: ${adWalletErr?.message || 'credit failed'}`);
            continue;
          }
          await supabase.from('creator_earnings').update({ wallet_credited: true }).eq('id', adEarning.id);
          results.adRevenue += share;
          console.log(`Ad revenue share: user=${creatorId} views=${views} share=$${share.toFixed(4)}`);
        }
      }
    }

    // ── 4. Subscription renewal reminders ────────────────────────────────
    const expiryWindow = new Date(Date.now() + 3 * 86400000).toISOString();
    const { data: expiringSubs } = await supabase
      .from('creator_subscriptions')
      .select('id, subscriber_id, creator_id, tier, expires_at')
      .eq('status', 'active')
      .lt('expires_at', expiryWindow)
      .gt('expires_at', new Date().toISOString());

    for (const sub of (expiringSubs ?? [])) {
      const { data: alreadyNotified } = await supabase.from('platform_inbox').select('id')
        .eq('user_id', sub.subscriber_id).ilike('subject', `%subscription expires%`)
        .gte('sent_at', new Date(Date.now() - 86400000).toISOString()).limit(1).maybeSingle();
      if (alreadyNotified) continue;

      await supabase.from('platform_inbox').insert({
        user_id:    sub.subscriber_id,
        subject:    `Your ${sub.tier} subscription expires soon`,
        body:       `Your subscription expires on ${new Date(sub.expires_at).toLocaleDateString()}. Renew to keep access to exclusive content.`,
        type:       'warning', icon_emoji: '⏰',
        cta_label:  'View Subscription', cta_url: '/profile',
      });
      results.subscriptions++;
    }

    // ── 5. Earnings milestones ────────────────────────────────────────────
    const { data: milestoneCheck } = await supabase
      .from('user_monetization')
      .select('user_id, total_earnings');

    const MILESTONES = [1, 5, 10, 50, 100, 500, 1000];
    for (const m of (milestoneCheck ?? [])) {
      const total = Number(m.total_earnings ?? 0);
      for (const milestone of MILESTONES) {
        if (total < milestone) continue;
        const { data: meta } = await supabase.from('platform_inbox').select('id')
          .eq('user_id', m.user_id).ilike('subject', `%$${milestone} earned%`)
          .limit(1).maybeSingle();
        if (meta) continue;
        await supabase.from('platform_inbox').insert({
          user_id: m.user_id,
          subject: `🎉 Milestone: $${milestone} earned!`,
          body:    `Congratulations! You've earned $${milestone} total on Testagram. Keep creating amazing content to grow your income.`,
          type:    'system', icon_emoji: '🏆',
          cta_label: 'View Earnings', cta_url: '/monetization',
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: any) {
    console.error('distribute-earnings error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
