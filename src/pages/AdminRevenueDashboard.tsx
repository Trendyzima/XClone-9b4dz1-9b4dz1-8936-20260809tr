import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { TopBar } from '@/components/layout/TopBar';
import { Loader2, DollarSign, TrendingUp, Users, Eye, MousePointerClick, Download, Calendar } from 'lucide-react';
import { formatNumber } from '@/lib/utils';
import { Button } from '@/components/ui/button';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function AdminRevenueAdBanner() { return <PageAdBanner />; }

interface RevenueStats {
  total_platform_revenue: number;
  total_campaigns: number;
  total_impressions: number;
  total_clicks: number;
  avg_ctr: number;
  monetized_creators: number;
  total_creator_earnings: number;
}

interface TopCreator {
  user_id: string;
  username: string;
  avatar_url: string;
  total_earnings: number;
  impressions: number;
}

export default function AdminRevenueDashboard() {
  const { user } = useAuth();
  useSEO({ noindex: true, title: 'Admin — Revenue Dashboard', url: '/admin/revenue' });
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<RevenueStats | null>(null);
  const [topCreators, setTopCreators] = useState<TopCreator[]>([]);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    checkAdmin();
  }, [user, timeRange]);

  const checkAdmin = async () => {
    const { data } = await supabase
      .from('admin_users')
      .select('id')
      .eq('user_id', user!.id)
      .single();

    if (!data) {
      navigate('/');
      return;
    }
    fetchRevenueStats();
  };

  const fetchRevenueStats = async () => {
    setLoading(true);
    try {
      // Get overall stats
      const { data: statsData } = await supabase
        .from('admin_revenue_stats')
        .select('*')
        .single();

      setStats(statsData);

      // Get top earning creators
      const { data: creatorsData } = await supabase
        .from('user_monetization')
        .select(`
          user_id,
          total_earnings,
          profiles(username, avatar_url)
        `)
        .eq('is_monetized', true)
        .order('total_earnings', { ascending: false })
        .limit(10);

      const creators = (creatorsData || []).map((c: any) => ({
        user_id: c.user_id,
        username: c.user_profiles.username,
        avatar_url: c.user_profiles.avatar_url,
        total_earnings: c.total_earnings,
        impressions: 0 // Can be calculated from ad_impressions table
      }));

      setTopCreators(creators);
    } catch (error) {
      console.error('Error fetching revenue stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportData = () => {
    if (!stats) return;

    const csv = [
      ['Metric', 'Value'],
      ['Total Platform Revenue (70%)', `$${formatNumber(stats.total_platform_revenue)}`],
      ['Total Campaigns', stats.total_campaigns],
      ['Total Impressions', stats.total_impressions],
      ['Total Clicks', stats.total_clicks],
      ['Average CTR', `${stats.avg_ctr.toFixed(2)}%`],
      ['Monetized Creators', stats.monetized_creators],
      ['Total Creator Earnings (30%)', `$${formatNumber(stats.total_creator_earnings)}`],
      ['', ''],
      ['Top Creators', ''],
      ['Username', 'Total Earnings'],
      ...topCreators.map(c => [c.username, `$${formatNumber(c.total_earnings)}`])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Revenue Dashboard" showBack />
      <AdminRevenueAdBanner />

      <div className="max-w-7xl mx-auto p-6">
        {/* Header Actions */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Admin Revenue Dashboard</h1>
          <Button onClick={exportData} variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>

        {/* Revenue Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-2 border-green-500/20 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-green-500/20 rounded-full">
                <DollarSign className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Platform Revenue (70%)</p>
                <h2 className="text-3xl font-bold text-green-600">
                  ${formatNumber(stats?.total_platform_revenue || 0)}
                </h2>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              From {stats?.total_campaigns || 0} active campaigns
            </p>
          </div>

          <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-2 border-blue-500/20 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-blue-500/20 rounded-full">
                <TrendingUp className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Creator Earnings (30%)</p>
                <h2 className="text-3xl font-bold text-blue-600">
                  ${formatNumber(stats?.total_creator_earnings || 0)}
                </h2>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Across {stats?.monetized_creators || 0} monetized creators
            </p>
          </div>

          <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border-2 border-purple-500/20 rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-purple-500/20 rounded-full">
                <Eye className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Impressions</p>
                <h2 className="text-3xl font-bold text-purple-600">
                  {formatNumber(stats?.total_impressions || 0)}
                </h2>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatNumber(stats?.total_clicks || 0)} clicks • {stats?.avg_ctr.toFixed(2)}% CTR
            </p>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="border border-border rounded-xl p-6">
            <h3 className="font-bold text-lg mb-4">Revenue Breakdown</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Platform Share</span>
                <span className="font-bold text-green-600">70%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div className="bg-green-600 h-3 rounded-full" style={{ width: '70%' }} />
              </div>

              <div className="flex items-center justify-between mt-4">
                <span className="text-muted-foreground">Creator Share</span>
                <span className="font-bold text-blue-600">30%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-3">
                <div className="bg-blue-600 h-3 rounded-full" style={{ width: '30%' }} />
              </div>
            </div>
          </div>

          <div className="border border-border rounded-xl p-6">
            <h3 className="font-bold text-lg mb-4">Engagement Metrics</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-5 h-5 text-muted-foreground" />
                  <span>Impressions</span>
                </div>
                <span className="font-bold">{formatNumber(stats?.total_impressions || 0)}</span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MousePointerClick className="w-5 h-5 text-muted-foreground" />
                  <span>Clicks</span>
                </div>
                <span className="font-bold">{formatNumber(stats?.total_clicks || 0)}</span>
              </div>

              <div className="flex items-center justify-between">
                <span>Click-Through Rate</span>
                <span className="font-bold text-primary">{stats?.avg_ctr.toFixed(2)}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Top Earning Creators */}
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="p-6 border-b border-border bg-muted/50">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Users className="w-6 h-6" />
              Top Earning Creators
            </h2>
          </div>

          <div className="divide-y divide-border">
            {topCreators.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                No monetized creators yet
              </div>
            ) : (
              topCreators.map((creator, index) => (
                <div key={creator.user_id} className="p-4 hover:bg-muted/50 transition-colors flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 flex items-center justify-center font-bold text-muted-foreground">
                      #{index + 1}
                    </div>
                    <div className="w-12 h-12 rounded-full bg-muted overflow-hidden">
                      {creator.avatar_url ? (
                        <img src={creator.avatar_url} alt={creator.username} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-lg font-bold">
                          {creator.username[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="font-bold">{creator.username}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatNumber(creator.impressions)} impressions
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-green-600">
                      ${formatNumber(creator.total_earnings)}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Earned</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
