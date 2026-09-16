import { useState, useEffect, useRef } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Loader2, AlertTriangle, Shield, Ban, TrendingDown, RefreshCw, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

import { PageAdBanner } from '@/components/features/AdSenseAd';
function FraudAdBanner() { return <PageAdBanner />; }

// Pure module-level helper — esbuild guard
// Avoids index-signature type annotations and Object.keys spread in function body
function buildChartSeries(rows: any[]): { date: string; low: number; medium: number; high: number; critical: number }[] {
  const dateKeys: string[] = [];
  // Pre-build 30-day array of ISO date strings
  for (let i = 29; i >= 0; i--) {
    dateKeys.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  }
  // Count per date/severity using parallel arrays
  const lowArr = new Array<number>(30).fill(0);
  const medArr = new Array<number>(30).fill(0);
  const highArr = new Array<number>(30).fill(0);
  const critArr = new Array<number>(30).fill(0);

  for (const row of rows) {
    const d = String(row.created_at ?? '').slice(0, 10);
    const idx = dateKeys.indexOf(d);
    if (idx < 0) continue;
    const sev = String(row.severity ?? 'low');
    if (sev === 'low') lowArr[idx]++;
    else if (sev === 'medium') medArr[idx]++;
    else if (sev === 'high') highArr[idx]++;
    else if (sev === 'critical') critArr[idx]++;
  }

  const result: { date: string; low: number; medium: number; high: number; critical: number }[] = [];
  for (let i = 0; i < 30; i++) {
    result.push({ date: dateKeys[i].slice(5), low: lowArr[i], medium: medArr[i], high: highArr[i], critical: critArr[i] });
  }
  return result;
}

interface FraudAlert {
  user_id: string;
  username: string;
  avatar_url: string;
  suspicious_clicks: number;
  click_rate: number;
  ip_addresses: string[];
  last_activity: string;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
}

export default function FraudDetection() {
  useSEO({ noindex: true, title: 'Admin — Fraud Detection', url: '/admin/fraud' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<FraudAlert[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<Set<string>>(new Set());
  const [chartData, setChartData] = useState<{ date: string; low: number; medium: number; high: number; critical: number }[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    checkAdmin();
  }, [user]);

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
    analyzeFraud();
    fetchChartData();
  };

  const fetchChartData = async () => {
    setLoadingChart(true);
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data } = await supabase
        .from('fraud_alerts')
        .select('severity, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: true });
      setChartData(buildChartSeries(data ?? []));
    } catch (_) { /* non-critical */ }
    setLoadingChart(false);
  };

  const analyzeFraud = async () => {
    setLoading(true);
    try {
      // Fetch ad impressions with click data
      const { data: impressions } = await supabase
        .from('ad_impressions')
        .select(`
          *,
          profiles (username, avatar_url)
        `)
        .eq('clicked', true);

      if (!impressions) {
        setLoading(false);
        return;
      }

      // Analyze click patterns per user
      const userClickMap = new Map<string, any>();

      impressions.forEach((imp: any) => {
        if (!imp.user_id) return;

        if (!userClickMap.has(imp.user_id)) {
          userClickMap.set(imp.user_id, {
            user_id: imp.user_id,
            username: imp.user_profiles?.username || 'Unknown',
            avatar_url: imp.user_profiles?.avatar_url,
            clicks: [],
            ips: new Set(),
          });
        }

        const userData = userClickMap.get(imp.user_id);
        userData.clicks.push(imp.created_at);
      });

      // Calculate fraud scores
      const fraudAlerts: FraudAlert[] = [];

      userClickMap.forEach((data) => {
        const clicks = data.clicks;
        const totalClicks = clicks.length;

        // Calculate click rate (clicks per hour)
        if (clicks.length < 2) return;

        const timeSpan = new Date(clicks[clicks.length - 1]).getTime() - new Date(clicks[0]).getTime();
        const hours = timeSpan / (1000 * 60 * 60);
        const clickRate = totalClicks / (hours || 1);

        // Determine risk level
        let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
        
        if (clickRate > 100) riskLevel = 'critical';
        else if (clickRate > 50) riskLevel = 'high';
        else if (clickRate > 20) riskLevel = 'medium';

        if (riskLevel !== 'low' || totalClicks > 50) {
          fraudAlerts.push({
            user_id: data.user_id,
            username: data.username,
            avatar_url: data.avatar_url,
            suspicious_clicks: totalClicks,
            click_rate: parseFloat(clickRate.toFixed(2)),
            ip_addresses: Array.from(data.ips),
            last_activity: clicks[clicks.length - 1],
            risk_level: riskLevel,
          });
        }
      });

      // Sort by risk level
      const riskOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      fraudAlerts.sort((a, b) => riskOrder[b.risk_level] - riskOrder[a.risk_level]);

      setAlerts(fraudAlerts);
    } catch (error) {
      console.error('Fraud analysis error:', error);
    } finally {
      setLoading(false);
    }
  };

  const blockUser = async (userId: string, username: string) => {
    if (!confirm(`Block ${username} from ad monetization?`)) return;

    try {
      // Disable user monetization
      const { error } = await supabase
        .from('user_monetization')
        .update({ is_monetized: false })
        .eq('user_id', userId);

      if (error) throw error;

      setBlockedUsers(prev => new Set(prev).add(userId));
      toast.success(`${username} blocked from monetization`);
      analyzeFraud();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const clearHistory = async (userId: string) => {
    if (!confirm('Clear this user\'s click history?')) return;

    try {
      const { error } = await supabase
        .from('ad_impressions')
        .delete()
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('Click history cleared');
      analyzeFraud();
    } catch (error: any) {
      toast.error(error.message);
    }
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
      <TopBar title="Fraud Detection" showBack />
      <FraudAdBanner />

      <div className="max-w-6xl mx-auto p-6">
        {/* 30-Day Fraud Alert Chart */}
        <div className="bg-card border border-border rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-primary" />
              <h2 className="font-bold">30-Day Fraud Alert Trend</h2>
            </div>
            <button onClick={fetchChartData} disabled={loadingChart} className="text-muted-foreground hover:text-foreground">
              <RefreshCw className={`w-4 h-4 ${loadingChart ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {chartData.some(d => d.low > 0 || d.medium > 0 || d.high > 0 || d.critical > 0) ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={6} stroke="hsl(var(--muted-foreground))" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid hsl(var(--border))' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="low" name="Low" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="medium" name="Medium" stroke="#f59e0b" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="high" name="High" stroke="#f97316" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="critical" name="Critical" stroke="#ef4444" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-28 text-muted-foreground text-sm">
              {loadingChart ? <Loader2 className="w-6 h-6 animate-spin text-primary" /> : 'No fraud alerts in the last 30 days'}
            </div>
          )}
        </div>

      {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              <span className="text-sm text-muted-foreground">Total Alerts</span>
            </div>
            <p className="text-3xl font-bold">{alerts.length}</p>
          </div>

          <div className="border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-5 h-5 text-orange-600" />
              <span className="text-sm text-muted-foreground">High Risk</span>
            </div>
            <p className="text-3xl font-bold text-orange-600">
              {alerts.filter(a => a.risk_level === 'high' || a.risk_level === 'critical').length}
            </p>
          </div>

          <div className="border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-2">
              <Ban className="w-5 h-5 text-red-600" />
              <span className="text-sm text-muted-foreground">Blocked Users</span>
            </div>
            <p className="text-3xl font-bold">{blockedUsers.size}</p>
          </div>
        </div>

        {/* Alerts */}
        <div className="border border-border rounded-xl">
          <div className="p-6 border-b border-border">
            <h2 className="text-xl font-bold">Fraud Alerts</h2>
            <p className="text-sm text-muted-foreground">
              Automated detection of suspicious ad click behavior
            </p>
          </div>

          <div className="divide-y divide-border">
            {alerts.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <Shield className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="font-semibold text-lg mb-2">No Suspicious Activity</p>
                <p className="text-sm">All ad interactions appear normal</p>
              </div>
            ) : (
              alerts.map((alert) => (
                <div key={alert.user_id} className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-muted overflow-hidden">
                        {alert.avatar_url ? (
                          <img src={alert.avatar_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center font-bold">
                            {alert.username[0].toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold">{alert.username}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            alert.risk_level === 'critical' ? 'bg-red-500/10 text-red-600' :
                            alert.risk_level === 'high' ? 'bg-orange-500/10 text-orange-600' :
                            alert.risk_level === 'medium' ? 'bg-yellow-500/10 text-yellow-600' :
                            'bg-blue-500/10 text-blue-600'
                          }`}>
                            {alert.risk_level.toUpperCase()} RISK
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => clearHistory(alert.user_id)}
                        variant="outline"
                        size="sm"
                      >
                        Clear History
                      </Button>
                      <Button
                        onClick={() => blockUser(alert.user_id, alert.username)}
                        variant="destructive"
                        size="sm"
                        disabled={blockedUsers.has(alert.user_id)}
                      >
                        <Ban className="w-4 h-4 mr-2" />
                        {blockedUsers.has(alert.user_id) ? 'Blocked' : 'Block'}
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Suspicious Clicks</p>
                      <p className="font-bold text-lg">{alert.suspicious_clicks}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Click Rate</p>
                      <p className="font-bold text-lg">{alert.click_rate}/hr</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Last Activity</p>
                      <p className="font-semibold">
                        {new Date(alert.last_activity).toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Risk Indicators</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {alert.click_rate > 50 && (
                          <span className="text-xs bg-red-500/10 text-red-600 px-2 py-1 rounded">
                            High frequency
                          </span>
                        )}
                        {alert.suspicious_clicks > 100 && (
                          <span className="text-xs bg-orange-500/10 text-orange-600 px-2 py-1 rounded">
                            Excessive clicks
                          </span>
                        )}
                      </div>
                    </div>
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
