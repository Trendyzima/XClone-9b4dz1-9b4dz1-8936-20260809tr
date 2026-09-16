import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Loader2, DollarSign, TrendingUp, Users, Download, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function RevenueAnalyticsAdBanner() { return <PageAdBanner />; }

interface Analytics {
  totalRevenue: number;
  platformRevenue: number;
  userRevenue: number;
  totalImpressions: number;
  totalClicks: number;
  avgCTR: number;
  avgRPM: number;
  topCreators: any[];
  revenueByMonth: any[];
}

export default function RevenueAnalytics() {
  useSEO({ noindex: true, title: 'Revenue Analytics', url: '/revenue-analytics' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    checkAdmin();
  }, [user]);

  useEffect(() => {
    if (analytics !== null) {
      fetchAnalytics();
    }
  }, [timeRange]);

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
    fetchAnalytics();
  };

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      // Calculate date filter
      let startDate: Date | null = null;
      const now = new Date();
      if (timeRange !== 'all') {
        const days = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
        startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      }

      // Fetch revenue shares
      let query = supabase
        .from('revenue_shares')
        .select('*');
      
      if (startDate) {
        query = query.gte('created_at', startDate.toISOString());
      }

      const { data: revenueData } = await query;

      // Calculate totals
      const totalRevenue = revenueData?.reduce((sum, r) => sum + (r.total_revenue || 0), 0) || 0;
      const platformRevenue = revenueData?.reduce((sum, r) => sum + (r.platform_share || 0), 0) || 0;
      const userRevenue = revenueData?.reduce((sum, r) => sum + (r.user_share || 0), 0) || 0;

      // Fetch ad impressions
      const { data: impressionsData } = await supabase
        .from('ad_impressions')
        .select('*');

      const totalImpressions = impressionsData?.length || 0;
      const totalClicks = impressionsData?.filter(i => i.clicked).length || 0;
      const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
      const avgRPM = totalImpressions > 0 ? (totalRevenue / totalImpressions) * 1000 : 0;

      // Top creators
      const { data: topCreatorsData } = await supabase
        .from('revenue_shares')
        .select(`
          user_id,
          total_revenue,
          platform_share,
          user_share,
          profiles (username, avatar_url, verified)
        `)
        .order('total_revenue', { ascending: false })
        .limit(10);

      setAnalytics({
        totalRevenue,
        platformRevenue,
        userRevenue,
        totalImpressions,
        totalClicks,
        avgCTR,
        avgRPM,
        topCreators: topCreatorsData || [],
        revenueByMonth: [], // TODO: Implement monthly breakdown
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!analytics) return;

    const csv = [
      ['Metric', 'Value'],
      ['Total Revenue', `$${analytics.totalRevenue.toFixed(2)}`],
      ['Platform Revenue (70%)', `$${analytics.platformRevenue.toFixed(2)}`],
      ['User Revenue (30%)', `$${analytics.userRevenue.toFixed(2)}`],
      ['Total Impressions', analytics.totalImpressions],
      ['Total Clicks', analytics.totalClicks],
      ['Average CTR', `${analytics.avgCTR.toFixed(2)}%`],
      ['Average RPM', `$${analytics.avgRPM.toFixed(2)}`],
      [''],
      ['Top Creators'],
      ['Username', 'Total Revenue', 'Platform Share', 'User Share'],
      ...analytics.topCreators.map(c => [
        c.user_profiles.username,
        `$${c.total_revenue.toFixed(2)}`,
        `$${c.platform_share.toFixed(2)}`,
        `$${c.user_share.toFixed(2)}`,
      ]),
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-analytics-${timeRange}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!analytics) return null;

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Revenue Analytics" showBack />
      <RevenueAnalyticsAdBanner />

      <div className="max-w-6xl mx-auto p-6">
        {/* Time Range Selector */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-2">
            {(['7d', '30d', '90d', 'all'] as const).map((range) => (
              <Button
                key={range}
                onClick={() => setTimeRange(range)}
                variant={timeRange === range ? 'default' : 'outline'}
                size="sm"
              >
                {range === 'all' ? 'All Time' : range.toUpperCase()}
              </Button>
            ))}
          </div>
          <Button onClick={exportCSV} variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>

        {/* Revenue Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="border border-border rounded-xl p-6 bg-gradient-to-br from-purple-500/10 to-pink-500/10">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-purple-600" />
              <span className="text-sm text-muted-foreground">Total Revenue</span>
            </div>
            <p className="text-3xl font-bold text-purple-600">
              ${analytics.totalRevenue.toFixed(2)}
            </p>
          </div>

          <div className="border border-border rounded-xl p-6 bg-gradient-to-br from-green-500/10 to-emerald-500/10">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-green-600" />
              <span className="text-sm text-muted-foreground">Platform (70%)</span>
            </div>
            <p className="text-3xl font-bold text-green-600">
              ${analytics.platformRevenue.toFixed(2)}
            </p>
          </div>

          <div className="border border-border rounded-xl p-6 bg-gradient-to-br from-blue-500/10 to-cyan-500/10">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5 text-blue-600" />
              <span className="text-sm text-muted-foreground">Creators (30%)</span>
            </div>
            <p className="text-3xl font-bold text-blue-600">
              ${analytics.userRevenue.toFixed(2)}
            </p>
          </div>

          <div className="border border-border rounded-xl p-6 bg-gradient-to-br from-orange-500/10 to-red-500/10">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-5 h-5 text-orange-600" />
              <span className="text-sm text-muted-foreground">Avg RPM</span>
            </div>
            <p className="text-3xl font-bold text-orange-600">
              ${analytics.avgRPM.toFixed(2)}
            </p>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="border border-border rounded-xl p-6">
            <h3 className="font-semibold mb-2">Total Impressions</h3>
            <p className="text-2xl font-bold">{formatNumber(analytics.totalImpressions)}</p>
          </div>

          <div className="border border-border rounded-xl p-6">
            <h3 className="font-semibold mb-2">Total Clicks</h3>
            <p className="text-2xl font-bold">{formatNumber(analytics.totalClicks)}</p>
          </div>

          <div className="border border-border rounded-xl p-6">
            <h3 className="font-semibold mb-2">Average CTR</h3>
            <p className="text-2xl font-bold">{analytics.avgCTR.toFixed(2)}%</p>
          </div>
        </div>

        {/* Top Creators */}
        <div className="border border-border rounded-xl p-6">
          <h2 className="text-xl font-bold mb-4">Top Earning Creators</h2>
          <div className="space-y-3">
            {analytics.topCreators.map((creator, index) => (
              <div key={creator.user_id} className="flex items-center justify-between p-3 border border-border rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center font-bold">
                    {index + 1}
                  </span>
                  <div className="w-10 h-10 rounded-full bg-muted overflow-hidden">
                    {creator.user_profiles.avatar_url ? (
                      <img src={creator.user_profiles.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center font-bold">
                        {creator.user_profiles.username[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <span className="font-semibold">{creator.user_profiles.username}</span>
                </div>
                <div className="text-right">
                  <p className="font-bold text-lg">${creator.total_revenue.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">
                    Platform: ${creator.platform_share.toFixed(2)} | User: ${creator.user_share.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
