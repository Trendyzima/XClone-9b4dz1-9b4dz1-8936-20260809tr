import { useEffect, useState } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { BarChart3, Loader2, Power, Plus, Target, Megaphone } from 'lucide-react';

interface Campaign { id: string; name: string; status: string; payment_status: string; priority: number; bid_cpm_micros: number; lifetime_budget_micros: number; funded_micros: number; targeting: Record<string, unknown>; }
interface Slot { id: string; code: string; kind: string; floor_cpm_micros: number; enabled: boolean; }
interface Creative { id: string; campaign_id: string; headline: string; body: string | null; cta: string; click_through_url: string; enabled: boolean; }

export default function AdConfigPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  useSEO({ noindex: true, title: 'Admin — Testagram Ads', url: '/admin/ad-config' });
  const [loading, setLoading] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);

  const load = async () => {
    if (!user || authLoading) return;
    try {
      const { data: adData, error: adError } = await supabase.functions.invoke('testagram-ads/admin', { body: { action: 'list' } });
      if (adError) throw new Error(adError.message);
      if (!adData?.ok) throw new Error(adData?.error || 'Unable to load the Testagram Ads backend');
      setCampaigns((adData.campaigns ?? []) as Campaign[]);
      setSlots((adData.slots ?? []) as Slot[]);
      setCreatives((adData.creatives ?? []) as Creative[]);
    } catch (error: any) {
      toast.error(error?.message || 'Unable to load ad configuration');
      setCampaigns([]); setSlots([]); setCreatives([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (authLoading) return; if (!user) { navigate('/auth'); return; } void load(); }, [user?.id, authLoading]);

  const toggleCampaign = async (campaign: Campaign) => {
    const next = campaign.status === 'active' ? 'paused' : 'active';
    const { data, error } = await supabase.functions.invoke('testagram-ads/admin', {
      body: { action: 'toggle_campaign', campaign_id: campaign.id, status: next },
    });
    if (error || !data?.ok) toast.error(data?.error || error?.message || 'Campaign status update failed');
    else { toast.success(`Campaign ${next}`); void load(); }
  };

  const toggleSlot = async (slot: Slot) => {
    const { data, error } = await supabase.functions.invoke('testagram-ads/admin', {
      body: { action: 'toggle_slot', slot_id: slot.id, enabled: !slot.enabled },
    });
    if (error || !data?.ok) toast.error(data?.error || error?.message || 'Slot update failed');
    else { toast.success(`Slot ${!slot.enabled ? 'enabled' : 'disabled'}`); void load(); }
  };

  const addHouseCampaign = () => navigate('/create-ad');

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  return <div className="min-h-screen bg-background pb-16"><TopBar title="Testagram Ads" showBack />
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><div className="flex items-center gap-3"><div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center"><Megaphone className="w-5 h-5 text-primary" /></div><div><h1 className="text-xl font-black">Testagram Ads Engine</h1><p className="text-sm text-muted-foreground">ZenAd decisioning customized for Testagram, with Supabase as the campaign ledger.</p></div></div></div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="border rounded-xl p-4"><div className="flex items-center gap-2 mb-2"><BarChart3 className="w-4 h-4 text-primary" /><span className="font-semibold">Active campaigns</span></div><p className="text-2xl font-black">{campaigns.filter(c=>c.status==='active').length}</p></div>
        <div className="border rounded-xl p-4"><div className="flex items-center gap-2 mb-2"><Target className="w-4 h-4 text-primary" /><span className="font-semibold">Enabled slots</span></div><p className="text-2xl font-black">{slots.filter(s=>s.enabled).length}</p></div>
      </div>
      <section className="border rounded-2xl p-5"><div className="flex items-center gap-2 mb-3"><Plus className="w-4 h-4"/><h2 className="font-bold">Create a paid advertiser campaign</h2></div><p className="text-sm text-muted-foreground mb-4">Campaigns must go through Testagram’s verified advertiser and M-Pesa settlement flow. Unpaid or unfunded campaigns are never activated by this dashboard.</p><Button onClick={addHouseCampaign}><Plus className="w-4 h-4 mr-1"/>Open campaign setup</Button></section>
      <section className="border rounded-2xl p-5"><div className="flex items-center justify-between mb-4"><h2 className="font-bold">Campaigns</h2><span className="text-xs text-muted-foreground">{creatives.length} creatives</span></div><div className="space-y-3">{campaigns.map(c=><div key={c.id} className="flex items-center justify-between gap-3 border rounded-xl p-3"><div className="min-w-0"><p className="font-semibold truncate">{c.name}</p><p className="text-xs text-muted-foreground">Priority {c.priority} · KES {(Number(c.bid_cpm_micros)/1_000_000).toFixed(3)} CPM · {c.status} · {c.payment_status}</p></div><Button size="sm" variant="outline" onClick={()=>toggleCampaign(c)} disabled={c.status!=='active' && (c.payment_status!=='funded' || Number(c.funded_micros)<Number(c.lifetime_budget_micros))}><Power className="w-4 h-4 mr-1"/>{c.status==='active'?'Pause':'Activate'}</Button></div>)}</div></section>
      <section className="border rounded-2xl p-5"><h2 className="font-bold mb-4">Ad inventory</h2><div className="space-y-2">{slots.map(s=><div key={s.id} className="flex items-center justify-between border rounded-xl p-3"><div><p className="font-semibold">{s.code}</p><p className="text-xs text-muted-foreground">{s.kind} · floor KES {(Number(s.floor_cpm_micros)/1_000_000).toFixed(3)} CPM</p></div><Button size="sm" variant="outline" onClick={()=>toggleSlot(s)}>{s.enabled?'Disable':'Enable'}</Button></div>)}</div></section>
    </div>
  </div>;
}
