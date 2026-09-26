import { useEffect, useState } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useGovernance } from '@/lib/governance';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BarChart3, DollarSign, Loader2, Power, Plus, Settings, Target, Megaphone } from 'lucide-react';

interface Campaign { id: string; name: string; status: string; priority: number; bid_cpm_micros: number; targeting: Record<string, unknown>; }
interface Slot { id: string; code: string; kind: string; floor_cpm_micros: number; enabled: boolean; }
interface Creative { id: string; campaign_id: string; headline: string; body: string | null; cta: string; click_through_url: string; enabled: boolean; }

export default function AdConfigPage() {
  const { user } = useAuth();
  const { governance, loading: governanceLoading } = useGovernance();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Admin — Testagram Ads', url: '/admin/ad-config' });
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [revenueShare, setRevenueShare] = useState(70);
  const [newCampaignName, setNewCampaignName] = useState('');
  const [newBid, setNewBid] = useState('2');
  const [adding, setAdding] = useState(false);

  const load = async () => {
    if (!user) return;
    if (governanceLoading) return;
    if (!governance.is_owner) { toast.error('Owner authorization required'); navigate('/admin/governance'); return; }
    const [{ data: c }, { data: s }, { data: cr }, { data: settings }] = await Promise.all([
      supabase.from('zenad_campaigns').select('id,name,status,priority,bid_cpm_micros,targeting').order('created_at', { ascending: false }),
      supabase.from('zenad_slots').select('id,code,kind,floor_cpm_micros,enabled').order('code'),
      supabase.from('zenad_creatives').select('id,campaign_id,headline,body,cta,click_through_url,enabled').order('created_at', { ascending: false }),
      supabase.from('platform_settings').select('setting_value').eq('setting_key', 'paypal_config').maybeSingle(),
    ]);
    setCampaigns((c ?? []) as Campaign[]); setSlots((s ?? []) as Slot[]); setCreatives((cr ?? []) as Creative[]);
    const value: any = settings?.setting_value ?? {};
    if (typeof value.revenue_share_percentage === 'number') setRevenueShare(value.revenue_share_percentage);
    setLoading(false);
  };

  useEffect(() => { if (!user) { navigate('/auth'); return; } if (governanceLoading) return; void load(); }, [user?.id, governanceLoading, governance.is_owner]);

  const toggleCampaign = async (campaign: Campaign) => {
    const next = campaign.status === 'active' ? 'paused' : 'active';
    const { error } = await supabase.from('zenad_campaigns').update({ status: next, updated_at: new Date().toISOString() }).eq('id', campaign.id);
    if (error) toast.error(error.message); else { toast.success(`Campaign ${next}`); void load(); }
  };

  const toggleSlot = async (slot: Slot) => {
    const { error } = await supabase.from('zenad_slots').update({ enabled: !slot.enabled }).eq('id', slot.id);
    if (error) toast.error(error.message); else { toast.success(`Slot ${!slot.enabled ? 'enabled' : 'disabled'}`); void load(); }
  };

  const updateRevenueShare = async () => {
    const value = Math.min(100, Math.max(0, Number(revenueShare)));
    const { error } = await supabase.from('platform_settings').upsert({ setting_key: 'paypal_config', setting_value: { revenue_share_percentage: value } });
    if (error) toast.error(error.message); else toast.success('Revenue share saved');
  };

  const addHouseCampaign = async () => {
    if (!newCampaignName.trim()) return;
    setAdding(true);
    try {
      const { data: advertiser, error: advertiserError } = await supabase.from('zenad_advertisers').insert({ name: newCampaignName.trim(), status: 'active' }).select('id').single();
      if (advertiserError) throw advertiserError;
      const bidMicros = Math.round(Number(newBid) * 1_000_000);
      const { data: campaign, error: campaignError } = await supabase.from('zenad_campaigns').insert({ advertiser_id: advertiser.id, name: newCampaignName.trim(), status: 'active', priority: 50, bid_cpm_micros: bidMicros, targeting: { countries: [], devices: [], genres: [], keywords: [], segments: [], frequencyCap: { maxImpressions: 3, windowHours: 24 } } }).select('id').single();
      if (campaignError) throw campaignError;
      const { error: appError } = await supabase.from('zenad_campaign_apps').insert({ campaign_id: campaign.id, app_id: 'testagram' });
      if (appError) throw appError;
      const { error: creativeError } = await supabase.from('zenad_creatives').insert({ campaign_id: campaign.id, headline: newCampaignName.trim(), body: 'Sponsored on Testagram', cta: 'Learn more', click_through_url: 'https://testagram.site', format: 'display' });
      if (creativeError) throw creativeError;
      toast.success('Campaign created and activated'); setNewCampaignName(''); void load();
    } catch (error: any) { toast.error(error.message); } finally { setAdding(false); }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return <div className="min-h-screen bg-background pb-16"><TopBar title="Testagram Ads" showBack />
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Megaphone className="w-5 h-5 text-primary" /></div><div><h1 className="text-xl font-black">Testagram Ads Engine</h1><p className="text-sm text-muted-foreground">ZenAd decisioning customized for Testagram, with Supabase as the campaign ledger.</p></div></div></div>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="border rounded-xl p-4"><div className="flex items-center gap-2 mb-2"><BarChart3 className="w-4 h-4 text-primary" /><span className="font-semibold">Active campaigns</span></div><p className="text-2xl font-black">{campaigns.filter(c=>c.status==='active').length}</p></div>
        <div className="border rounded-xl p-4"><div className="flex items-center gap-2 mb-2"><Target className="w-4 h-4 text-primary" /><span className="font-semibold">Enabled slots</span></div><p className="text-2xl font-black">{slots.filter(s=>s.enabled).length}</p></div>
        <div className="border rounded-xl p-4"><div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-primary" /><span className="font-semibold">Creator share</span></div><p className="text-2xl font-black">{100-revenueShare}%</p></div>
      </div>
      <section className="border rounded-2xl p-5"><div className="flex items-center gap-2 mb-4"><Plus className="w-4 h-4"/><h2 className="font-bold">Create a direct campaign</h2></div><div className="grid md:grid-cols-[1fr_150px_auto] gap-3"><Input value={newCampaignName} onChange={e=>setNewCampaignName(e.target.value)} placeholder="Advertiser / campaign name"/><Input value={newBid} onChange={e=>setNewBid(e.target.value)} type="number" min="0.01" step="0.01" placeholder="CPM USD"/><Button onClick={addHouseCampaign} disabled={adding||!newCampaignName.trim()}>{adding?<Loader2 className="w-4 h-4 animate-spin"/>:<Plus className="w-4 h-4 mr-1"/>}Create</Button></div><p className="text-xs text-muted-foreground mt-2">The campaign is stored in Supabase and competes using ZenAd priority, CPM floor, targeting and frequency caps.</p></section>
      <section className="border rounded-2xl p-5"><div className="flex items-center justify-between mb-4"><h2 className="font-bold">Campaigns</h2><span className="text-xs text-muted-foreground">{creatives.length} creatives</span></div><div className="space-y-3">{campaigns.map(c=><div key={c.id} className="flex items-center justify-between gap-3 border rounded-xl p-3"><div className="min-w-0"><p className="font-semibold truncate">{c.name}</p><p className="text-xs text-muted-foreground">Priority {c.priority} · ${(Number(c.bid_cpm_micros)/1_000_000).toFixed(2)} CPM · {c.status}</p></div><Button size="sm" variant="outline" onClick={()=>toggleCampaign(c)}><Power className="w-4 h-4 mr-1"/>{c.status==='active'?'Pause':'Activate'}</Button></div>)}</div></section>
      <section className="border rounded-2xl p-5"><h2 className="font-bold mb-4">Ad inventory</h2><div className="space-y-2">{slots.map(s=><div key={s.id} className="flex items-center justify-between border rounded-xl p-3"><div><p className="font-semibold">{s.code}</p><p className="text-xs text-muted-foreground">{s.kind} · floor ${(Number(s.floor_cpm_micros)/1_000_000).toFixed(2)} CPM</p></div><Button size="sm" variant="outline" onClick={()=>toggleSlot(s)}>{s.enabled?'Disable':'Enable'}</Button></div>)}</div></section>
      <section className="border rounded-2xl p-5"><div className="flex items-center gap-2 mb-4"><Settings className="w-4 h-4"/><h2 className="font-bold">Creator revenue share</h2></div><div className="flex gap-3 items-end"><div className="flex-1"><label className="text-sm font-medium">Platform share (%)</label><Input type="number" min="0" max="100" value={revenueShare} onChange={e=>setRevenueShare(Number(e.target.value))}/></div><Button onClick={updateRevenueShare}>Save</Button></div><p className="text-xs text-muted-foreground mt-2">This controls the existing creator monetization split; ZenAd keeps the ad decisioning and billing ledger separate from creator payouts.</p></section>
    </div>
  </div>;
}
