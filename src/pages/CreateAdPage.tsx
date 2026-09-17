import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { trackTestagramEvent, TestagramEvent } from '@/lib/testagram-analytics';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Megaphone, Image as ImageIcon, Loader2, CheckCircle2, Eye, TrendingUp, Clock, X, Info, CalendarClock, Zap, BookOpen, ToggleLeft, ToggleRight } from 'lucide-react';
import { toast } from 'sonner';

const MIN_BUDGET_KES = 500;
const ZENAD_BID_CPM_MICROS = 50000;
const DEFAULT_CLICK_URL = 'https://testagram.site';

export default function CreateAdPage() {
  useSEO({ noindex: true, title: 'Create Advertisement', url: '/create-ad' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'mpesa' | 'success'>('form');
  const [title, setTitle] = useState(searchParams.get('title') ?? '');
  const [description, setDescription] = useState(searchParams.get('desc') ?? '');
  const [targetUrl, setTargetUrl] = useState('');
  const [budgetKes, setBudgetKes] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fromPostId = searchParams.get('from_post');
  const [phone, setPhone] = useState('');
  const [adId, setAdId] = useState<string | null>(null);
  const [stkLoading, setStkLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'checking' | 'paid'>('pending');
  const [checkoutRequestId, setCheckoutRequestId] = useState<string | null>(null);
  const paymentFinalizedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [enableSchedule, setEnableSchedule] = useState(false);
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [durationDays, setDurationDays] = useState(30);
  const [targetInterests, setTargetInterests] = useState<string[]>([]);
  const INTEREST_OPTIONS = ['Tech', 'Fashion', 'Food', 'Travel', 'Sports', 'Music', 'Business', 'Art', 'Gaming', 'Health', 'Education', 'Finance'];
  const [isStoryFormat, setIsStoryFormat] = useState(false);

  useEffect(() => { if (!user) navigate('/auth'); }, [user, navigate]);
  useEffect(() => () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); }, []);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      setImage(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  /** Create the canonical ZenAd advertiser, campaign and creative. */
  const handleSubmitAd = async () => {
    const parsedBudget = Number(budgetKes);
    if (!title.trim() || !description.trim() || !Number.isFinite(parsedBudget) || parsedBudget < MIN_BUDGET_KES) {
      toast.error(`Please fill all fields. Minimum budget is KES ${MIN_BUDGET_KES}.`);
      return;
    }
    if (enableSchedule && (!scheduleStart || !scheduleEnd)) {
      toast.error('Please select both a schedule start and end date.');
      return;
    }

    const startsAt = enableSchedule && scheduleStart ? new Date(scheduleStart) : new Date();
    const endsAt = enableSchedule && scheduleEnd ? new Date(scheduleEnd) : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
      toast.error('The campaign end date must be after the start date.');
      return;
    }

    setLoading(true);
    try {
      let imageUrl: string | null = null;
      if (image) {
        const ext = image.name.split('.').pop() || 'jpg';
        const fileName = `ads/${user!.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('posts').upload(fileName, image);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('posts').getPublicUrl(fileName);
        imageUrl = publicUrl;
      }

      let { data: advertiser, error: advertiserError } = await supabase
        .from('zenad_advertisers')
        .select('id,owner_user_id,status')
        .eq('owner_user_id', user!.id)
        .maybeSingle();
      if (advertiserError) throw advertiserError;
      if (!advertiser) {
        const inserted = await supabase
          .from('zenad_advertisers')
          .insert({ name: 'Testagram Advertiser', owner_user_id: user!.id, status: 'active' })
          .select('id,owner_user_id,status')
          .single();
        if (inserted.error) throw inserted.error;
        advertiser = inserted.data;
      }

      const lifetimeBudgetMicros = Math.round(parsedBudget * 1_000_000);
      const { data: campaign, error: campaignError } = await supabase
        .from('zenad_campaigns')
        .insert({
          advertiser_id: advertiser.id,
          name: title.trim(),
          status: 'draft',
          priority: 50,
          bid_cpm_micros: ZENAD_BID_CPM_MICROS,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          targeting: {
            interests: targetInterests,
            story_format: isStoryFormat,
            source_post_id: fromPostId || null,
          },
          currency: 'KES',
          lifetime_budget_micros: lifetimeBudgetMicros,
          payment_status: 'pending',
          funded_micros: 0,
          billing_model: 'cpm',
        })
        .select('id')
        .single();
      if (campaignError || !campaign?.id) throw campaignError || new Error('Failed to create advertisement campaign');

      const { error: creativeError } = await supabase
        .from('zenad_creatives')
        .insert({
          campaign_id: campaign.id,
          format: isStoryFormat ? 'story' : 'display',
          headline: title.trim(),
          body: description.trim(),
          cta: 'Learn more',
          asset_url: imageUrl,
          click_through_url: targetUrl.trim() || DEFAULT_CLICK_URL,
          weight: 1,
          enabled: true,
        });
      if (creativeError) {
        await supabase.from('zenad_campaigns').delete().eq('id', campaign.id).eq('advertiser_id', advertiser.id);
        throw creativeError;
      }

      setAdId(campaign.id);
      trackTestagramEvent(TestagramEvent.AD_CREATED, {
        ad_id: campaign.id,
        campaign_id: campaign.id,
        amount_kes: Math.ceil(parsedBudget),
        payment_method: 'mpesa',
      });
      setStep('mpesa');
    } catch (error: any) {
      toast.error(error.message || 'Failed to create ad');
    } finally {
      setLoading(false);
    }
  };

  /** Trigger the dedicated M-Pesa campaign-payment endpoint. */
  const handleMpesaPay = async () => {
    if (!phone.trim() || !adId || stkLoading || paymentFinalizedRef.current) return;
    const digits = phone.replace(/\D/g, '');
    const cleanPhone = digits.startsWith('254') && digits.length === 12 ? digits : digits.startsWith('0') && digits.length === 10 ? `254${digits.slice(1)}` : (digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9 ? `254${digits}` : '';
    if (cleanPhone.length !== 12) { toast.error('Enter a valid Kenyan phone number e.g. 0712345678'); return; }
    const amountKes = Math.ceil(Number(budgetKes));
    if (!Number.isFinite(amountKes) || amountKes < MIN_BUDGET_KES) { toast.error('Invalid advertisement budget.'); return; }

    setStkLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-ad-payment', { body: { ad_id: adId, amount_kes: amountKes, phone: cleanPhone } });
      if (error) throw new Error(error.message);
      const acceptedCheckoutId = String(data?.checkout_request_id || '');
      if (!data?.success || data?.status !== 'pending' || !acceptedCheckoutId) throw new Error(data?.error || 'M-Pesa STK push was not accepted');
      setCheckoutRequestId(acceptedCheckoutId);
      trackTestagramEvent(TestagramEvent.AD_PAYMENT_INITIATED, { ad_id: adId, campaign_id: adId, amount_kes: amountKes, payment_method: 'mpesa', checkout_request_id: acceptedCheckoutId });
      toast.success('M-Pesa prompt sent! Check your phone and enter your PIN.');
      pollPaymentStatus(acceptedCheckoutId, adId);
    } catch (error: any) {
      toast.error(error.message || 'Failed to initiate M-Pesa payment');
    } finally { setStkLoading(false); }
  };

  /** Poll the canonical ad payment ledger; only the server settles the campaign. */
  const pollPaymentStatus = async (checkoutId: string, adIdParam: string) => {
    if (paymentFinalizedRef.current) return;
    setPaymentStatus('checking');
    let attempts = 0;
    const maxAttempts = 24;

    const poll = async () => {
      if (paymentFinalizedRef.current) return;
      try {
        const { data: payment, error: paymentError } = await supabase
          .from('zenad_mpesa_payments')
          .select('id,user_id,ad_id,amount_kes,status,result_code,mpesa_receipt_number,checkout_request_id')
          .eq('checkout_request_id', checkoutId)
          .eq('ad_id', adIdParam)
          .eq('user_id', user!.id)
          .maybeSingle();
        if (paymentError) throw paymentError;

        if (payment?.status === 'completed') {
          if (payment.ad_id !== adIdParam || payment.user_id !== user!.id || payment.checkout_request_id !== checkoutId) throw new Error('Payment identity verification failed');
          if (!payment.mpesa_receipt_number || String(payment.result_code) !== '0') throw new Error('Payment completion verification failed');
          if (Math.round(Number(payment.amount_kes) * 100) !== Math.round(Math.ceil(Number(budgetKes)) * 100)) throw new Error('Payment amount verification failed');

          const { data: campaign, error: campaignError } = await supabase
            .from('zenad_campaigns')
            .select('id,advertiser_id,payment_status,status,payment_reference,starts_at,ends_at,lifetime_budget_micros,funded_micros')
            .eq('id', adIdParam)
            .maybeSingle();
          if (campaignError) throw campaignError;
          if (!campaign || campaign.advertiser_id == null || campaign.payment_status !== 'funded' || campaign.payment_reference !== payment.mpesa_receipt_number || campaign.status !== 'active') throw new Error('Payment was confirmed but campaign activation was not confirmed');

          paymentFinalizedRef.current = true;
          trackTestagramEvent(TestagramEvent.AD_PAYMENT_CONFIRMED, { ad_id: adIdParam, campaign_id: adIdParam, amount_kes: Number(payment.amount_kes), payment_method: 'mpesa', checkout_request_id: checkoutId, mpesa_receipt_number: payment.mpesa_receipt_number });
          trackTestagramEvent(TestagramEvent.AD_ACTIVATED, { ad_id: adIdParam, campaign_id: adIdParam, amount_kes: Number(payment.amount_kes), payment_method: 'mpesa', checkout_request_id: checkoutId });
          setPaymentStatus('paid');
          setStep('success');
          toast.success('🎉 Payment confirmed! Your ad is now live.');
          return;
        }

        if (payment?.status === 'failed') {
          paymentFinalizedRef.current = true;
          trackTestagramEvent(TestagramEvent.AD_PAYMENT_FAILED, { ad_id: adIdParam, campaign_id: adIdParam, amount_kes: Number(payment.amount_kes), payment_method: 'mpesa', checkout_request_id: checkoutId, result_code: payment.result_code });
          setPaymentStatus('pending');
          toast.error('Payment failed. Please try again.');
          return;
        }

        attempts++;
        if (attempts < maxAttempts) pollTimerRef.current = setTimeout(poll, 5000);
        else { setPaymentStatus('pending'); toast.error('Payment timeout. If you paid, it will be verified shortly.'); }
      } catch (error) {
        if (paymentFinalizedRef.current) return;
        attempts++;
        if (attempts < maxAttempts) pollTimerRef.current = setTimeout(poll, 5000);
        else { setPaymentStatus('pending'); toast.error(error instanceof Error ? error.message : 'Payment verification timed out.'); }
      }
    };
    pollTimerRef.current = setTimeout(poll, 5000);
  };

  if (!user) return null;

  if (step === 'success') return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-8 text-center">
      <div className="w-24 h-24 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6"><CheckCircle2 className="w-14 h-14 text-green-500" /></div>
      <h2 className="text-2xl font-bold mb-2">Ad is Live! 🎉</h2>
      <p className="text-muted-foreground mb-2">Your advertisement has been activated and is scheduled according to your campaign dates.</p>
      <p className="text-sm text-muted-foreground mb-8">Budget: KES {budgetKes} · Estimated {Math.floor(parseFloat(budgetKes) / 0.5).toLocaleString()} impressions</p>
      <div className="flex gap-3"><Button onClick={() => navigate('/my-ads')} className="rounded-full px-6">View My Ads</Button><Button variant="outline" onClick={() => navigate('/')} className="rounded-full px-6">Go Home</Button></div>
    </div>
  );

  if (step === 'mpesa') return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      <TopBar title="Pay via M-Pesa" showBack />
      <div className="max-w-md mx-auto p-6 space-y-6">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-5"><div className="flex items-start gap-3"><div className="w-12 h-12 rounded-xl bg-green-600 flex items-center justify-center flex-shrink-0"><span className="text-white text-xl font-black">M</span></div><div><h3 className="font-bold text-lg">M-Pesa Payment</h3><p className="text-sm text-muted-foreground">Pay for your advertisement</p><p className="text-2xl font-black text-green-600 mt-1">KES {parseFloat(budgetKes).toLocaleString()}</p></div></div></div>
        <div className="bg-card border border-border rounded-xl p-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Ad Title</span><span className="font-medium truncate max-w-[200px]">{title}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Budget</span><span className="font-bold text-primary">KES {parseFloat(budgetKes).toLocaleString()}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Est. Impressions</span><span className="font-medium">{Math.floor(parseFloat(budgetKes) / 0.5).toLocaleString()}</span></div></div>
        {paymentStatus === 'checking' ? <div className="text-center py-8"><div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div><p className="font-semibold">Waiting for payment confirmation...</p><p className="text-sm text-muted-foreground mt-2">Enter your M-Pesa PIN on your phone.</p><p className="text-xs text-muted-foreground mt-1">Your campaign activates automatically only after server-side payment verification.</p></div> : <><div><label className="block text-sm font-semibold mb-2">Your M-Pesa Phone Number *</label><Input type="tel" placeholder="07XX XXX XXX" value={phone} onChange={e => setPhone(e.target.value)} className="text-lg" /><p className="text-xs text-muted-foreground mt-1">A payment request will be sent to this number.</p></div><div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4"><div className="flex items-start gap-2"><Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" /><div className="text-xs text-blue-700 dark:text-blue-300 space-y-1"><p><strong>How it works:</strong></p><p>1. Enter your phone number and tap "Pay Now"</p><p>2. An M-Pesa prompt appears on your phone</p><p>3. Enter your PIN to confirm payment</p><p>4. Your campaign activates only after verified payment.</p></div></div></div><Button onClick={handleMpesaPay} disabled={stkLoading || !phone.trim()} className="w-full py-6 text-lg bg-green-600 hover:bg-green-700 rounded-xl">{stkLoading ? <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Sending M-Pesa Request...</> : <>Pay KES {parseFloat(budgetKes || '0').toLocaleString()} via M-Pesa</>}</Button><button onClick={() => setStep('form')} className="w-full text-sm text-muted-foreground hover:text-foreground text-center">← Back to Ad Details</button></>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0"><TopBar title="Create Advertisement" showBack /><div className="max-w-2xl mx-auto p-6 space-y-6">
      {fromPostId && <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl"><div className="w-9 h-9 bg-amber-500/20 rounded-xl flex items-center justify-center shrink-0"><Zap className="w-5 h-5 text-amber-600" /></div><div><p className="text-sm font-bold text-amber-700 dark:text-amber-400">Boosting your post as an ad</p><p className="text-xs text-amber-600 dark:text-amber-500">Content and image pre-filled from your post. Adjust as needed below.</p></div></div>}
      <div className="bg-gradient-to-r from-primary/10 to-purple-500/10 border border-primary/20 rounded-2xl p-6"><div className="flex items-center gap-3 mb-3"><div className="p-3 bg-primary/20 rounded-xl"><Megaphone className="w-7 h-7 text-primary" /></div><div><h2 className="text-xl font-bold">Promote Your Business</h2><p className="text-sm text-muted-foreground">Reach thousands of active users</p></div></div><div className="grid grid-cols-3 gap-3 mt-4 text-center">{[{icon:Eye,label:'10K+',sub:'daily active users'},{icon:TrendingUp,label:'3×',sub:'engagement boost'},{icon:Clock,label:'1 hr',sub:'to go live'}].map((s,i)=><div key={i} className="bg-background/60 rounded-xl p-2"><s.icon className="w-4 h-4 text-primary mx-auto mb-1"/><p className="font-bold text-sm">{s.label}</p><p className="text-xs text-muted-foreground">{s.sub}</p></div>)}</div></div>
      <div className="space-y-5">
        <div><label className="block text-sm font-semibold mb-2">Ad Title *</label><Input placeholder="Enter a catchy title..." value={title} onChange={e=>setTitle(e.target.value)} maxLength={100}/><p className="text-xs text-muted-foreground mt-1">{title.length}/100</p></div>
        <div><label className="block text-sm font-semibold mb-2">Description *</label><Textarea placeholder="Describe what you're promoting..." value={description} onChange={e=>setDescription(e.target.value)} className="min-h-[120px]" maxLength={500}/><p className="text-xs text-muted-foreground mt-1">{description.length}/500</p></div>
        <div><label className="block text-sm font-semibold mb-2">Target URL (optional)</label><Input type="url" placeholder="https://example.com" value={targetUrl} onChange={e=>setTargetUrl(e.target.value)}/></div>
        <div><label className="block text-sm font-semibold mb-2">Ad Image (optional)</label>{imagePreview?<div className="relative rounded-xl overflow-hidden border border-border"><img src={imagePreview} alt="Ad preview" className="w-full max-h-64 object-cover"/><button onClick={()=>{setImage(null);setImagePreview(null)}} className="absolute top-2 right-2 bg-black/80 text-white rounded-full w-8 h-8 flex items-center justify-center"><X className="w-4 h-4"/></button></div>:<label className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-muted/50 transition-colors"><ImageIcon className="w-10 h-10 text-muted-foreground mb-2"/><span className="text-sm text-muted-foreground font-medium">Click to upload image</span><span className="text-xs text-muted-foreground mt-0.5">PNG, JPG up to 10MB</span><input type="file" accept="image/*" className="hidden" onChange={handleImageChange}/></label>}</div>
        <div className="space-y-3"><label className="block text-sm font-semibold">Campaign Duration</label><div className="grid grid-cols-4 gap-2">{[7,14,30,60].map(d=><button key={d} onClick={()=>{setDurationDays(d);setEnableSchedule(false)}} className={`py-2 rounded-xl border-2 text-sm font-semibold transition-all ${!enableSchedule&&durationDays===d?'border-primary bg-primary/10 text-primary':'border-border hover:border-primary/30'}`}>{d}d</button>)}</div><button onClick={()=>setEnableSchedule(v=>!v)} className={`flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-xl border-2 w-full transition-all ${enableSchedule?'border-primary bg-primary/10 text-primary':'border-border hover:border-primary/30'}`}><CalendarClock className="w-4 h-4"/>Custom schedule {enableSchedule?'(on)':'(pick dates)'}</button>{enableSchedule&&<div className="grid grid-cols-2 gap-3"><div><label className="text-xs font-semibold text-muted-foreground mb-1 block">Start date</label><input type="datetime-local" value={scheduleStart} onChange={e=>setScheduleStart(e.target.value)} min={new Date().toISOString().slice(0,16)} className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"/></div><div><label className="text-xs font-semibold text-muted-foreground mb-1 block">End date</label><input type="datetime-local" value={scheduleEnd} onChange={e=>setScheduleEnd(e.target.value)} min={scheduleStart||new Date().toISOString().slice(0,16)} className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"/></div></div>}</div>
        <div><label className="block text-sm font-semibold mb-2">Target Audience (optional)</label><p className="text-xs text-muted-foreground mb-2">Select interests to show your ad to relevant users</p><div className="flex flex-wrap gap-2">{INTEREST_OPTIONS.map(interest=>{const selected=targetInterests.includes(interest);return <button key={interest} onClick={()=>setTargetInterests(prev=>selected?prev.filter(i=>i!==interest):[...prev,interest])} className={`px-3 py-1.5 rounded-full text-sm border-2 font-medium transition-all ${selected?'border-primary bg-primary/10 text-primary':'border-border hover:border-primary/30'}`}>{interest}</button>})}</div>{targetInterests.length>0&&<p className="text-xs text-primary mt-1.5 font-medium">{targetInterests.length} interest{targetInterests.length!==1?'s':''} selected — your campaign will target matching users</p>}</div>
        <div className={`rounded-2xl border-2 p-4 transition-all ${isStoryFormat?'border-primary bg-primary/5':'border-border'}`}><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isStoryFormat?'bg-primary/15':'bg-muted'}`}><BookOpen className={`w-5 h-5 ${isStoryFormat?'text-primary':'text-muted-foreground'}`}/></div><div><p className="text-sm font-bold">Story Format Ad</p><p className="text-xs text-muted-foreground">Full-screen 9:16 vertical ad in Stories feed</p></div></div><button onClick={()=>setIsStoryFormat(v=>!v)} className="shrink-0">{isStoryFormat?<ToggleRight className="w-9 h-9 text-primary"/>:<ToggleLeft className="w-9 h-9 text-muted-foreground"/>}</button></div>{isStoryFormat&&<div className="mt-3 p-3 bg-primary/8 border border-primary/20 rounded-xl"><p className="text-xs font-bold text-primary mb-1.5">📖 Story Format tips</p><ul className="text-xs text-muted-foreground space-y-0.5"><li>• Use vertical (9:16) portrait images for best display</li><li>• Story targeting is stored with the campaign.</li><li>• Campaign scheduling remains authoritative.</li></ul></div>}</div>
        <div><label className="block text-sm font-semibold mb-2">Ad Budget (KES) *</label><Input type="number" placeholder={`Minimum KES ${MIN_BUDGET_KES}`} value={budgetKes} onChange={e=>setBudgetKes(e.target.value)} min={MIN_BUDGET_KES} step="100"/>{budgetKes&&parseFloat(budgetKes)>=MIN_BUDGET_KES&&<div className="mt-2 p-3 bg-muted/50 rounded-lg text-xs text-muted-foreground space-y-1"><p>💡 Estimated {Math.floor(parseFloat(budgetKes)/0.5).toLocaleString()} impressions</p><p>📱 Paid via M-Pesa — server-verified campaign funding</p><p>🏃 Runs for approximately {enableSchedule?'the selected schedule':`${durationDays} days`}</p></div>}</div>
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4"><div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center"><span className="text-white text-sm font-black">M</span></div><p className="font-semibold text-sm">M-Pesa Payment</p></div><p className="text-xs text-green-700 dark:text-green-400">Payment is verified server-side before campaign funding and activation. Your selected campaign dates are preserved.</p></div>
        <Button onClick={handleSubmitAd} disabled={loading||!title||!description||!budgetKes||parseFloat(budgetKes)<MIN_BUDGET_KES} className="w-full py-6 text-base rounded-xl">{loading?<Loader2 className="w-5 h-5 animate-spin mr-2"/>:<Megaphone className="w-5 h-5 mr-2"/>}Continue to M-Pesa Payment</Button>
      </div>
    </div></div>
  );
}
