import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { trackTestagramEvent, TestagramEvent } from '@/lib/testagram-analytics';
import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, Megaphone, Image as ImageIcon, X } from 'lucide-react';
import { toast } from 'sonner';

const MIN_BUDGET_KES = 500;
const INTERESTS = ['Tech','Fashion','Food','Travel','Sports','Music','Business','Art','Gaming','Health','Education','Finance'];

type Step = 'form' | 'mpesa' | 'success';

export default function CreateAdPageCanonical() {
  useSEO({ noindex: true, title: 'Create Advertisement', url: '/create-ad' });
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState(params.get('title') ?? '');
  const [description, setDescription] = useState(params.get('desc') ?? '');
  const [targetUrl, setTargetUrl] = useState('https://testagram.site');
  const [budget, setBudget] = useState('');
  const [phone, setPhone] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [story, setStory] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [checkoutId, setCheckoutId] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'checking' | 'paid'>('pending');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalized = useRef(false);

  useEffect(() => { if (!user) navigate('/auth'); }, [user, navigate]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const chooseImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    if (!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(file.type)) { toast.error('Use JPG, PNG, WebP, GIF or AVIF.'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Ad image must be 10MB or smaller.'); return; }
    setImage(file); setPreview(URL.createObjectURL(file));
  };

  const createCampaign = async () => {
    const amount = Number(budget);
    if (!user || !title.trim() || !description.trim() || !Number.isFinite(amount) || amount < MIN_BUDGET_KES) { toast.error(`Complete the required fields. Minimum budget is KES ${MIN_BUDGET_KES}.`); return; }
    const startAt = start ? new Date(start) : new Date();
    const endAt = end ? new Date(end) : new Date(Date.now() + 30 * 86400000);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) { toast.error('Campaign end must be after start.'); return; }
    setLoading(true);
    try {
      const targeting = { countries: [], devices: [], genres: [], keywords: [], segments: [], interests: interests.map(x => x.toLowerCase()) };
      const { data, error } = await supabase.functions.invoke('zenad-campaign', {
        body: {
          name: title.trim(), headline: title.trim(), description: description.trim(),
          click_through_url: targetUrl.trim() || 'https://testagram.site',
          budget_kes: amount, bid_cpm_kes: 0.05, start_at: startAt.toISOString(), end_at: endAt.toISOString(),
          format: story ? 'story' : 'display', targeting,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.ok || !data?.campaign?.id || !data?.creative?.id) throw new Error(data?.error || 'Campaign creation failed');
      const id = String(data.campaign.id);
      if (image) {
        const form = new FormData();
        form.append('campaign_id', id); form.append('file', image);
        const upload = await supabase.functions.invoke('zenad-ad-asset-upload', { body: form });
        if (upload.error) throw new Error(upload.error.message);
        if (!upload.data?.ok || !upload.data?.asset_url) throw new Error(upload.data?.error || 'Ad asset upload failed');
      }
      setCampaignId(id);
      trackTestagramEvent(TestagramEvent.AD_CREATED, { ad_id: id, campaign_id: id, amount_kes: Math.ceil(amount), payment_method: 'mpesa', format: story ? 'story' : 'display' });
      setStep('mpesa');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to create advertisement'); }
    finally { setLoading(false); }
  };

  const pay = async () => {
    if (!campaignId || !phone.trim() || loading || finalized.current) return;
    const digits = phone.replace(/\D/g, '');
    const clean = digits.startsWith('254') && digits.length === 12 ? digits : digits.startsWith('0') && digits.length === 10 ? `254${digits.slice(1)}` : (digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9 ? `254${digits}` : '';
    const amount = Math.ceil(Number(budget));
    if (clean.length !== 12) { toast.error('Enter a valid Kenyan phone number.'); return; }
    if (!Number.isFinite(amount) || amount < MIN_BUDGET_KES) { toast.error('Invalid budget.'); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mpesa-ad-payment', { body: { ad_id: campaignId, amount_kes: amount, phone: clean } });
      if (error) throw new Error(error.message);
      const id = String(data?.checkout_request_id ?? '');
      if (!data?.success || data?.status !== 'pending' || !id) throw new Error(data?.error || 'M-Pesa request was not accepted');
      setCheckoutId(id); setPaymentStatus('checking');
      trackTestagramEvent(TestagramEvent.AD_PAYMENT_INITIATED, { ad_id: campaignId, campaign_id: campaignId, amount_kes: amount, payment_method: 'mpesa', checkout_request_id: id });
      poll(id, campaignId, amount);
    } catch (error) { toast.error(error instanceof Error ? error.message : 'M-Pesa request failed'); }
    finally { setLoading(false); }
  };

  const poll = (checkout: string, id: string, amount: number) => {
    let attempts = 0;
    const run = async () => {
      if (finalized.current) return;
      try {
        const { data: payment, error } = await supabase.from('zenad_mpesa_payments').select('id,user_id,ad_id,amount_kes,status,result_code,mpesa_receipt_number,checkout_request_id').eq('checkout_request_id', checkout).eq('ad_id', id).eq('user_id', user!.id).maybeSingle();
        if (error) throw error;
        if (payment?.status === 'completed') {
          if (payment.checkout_request_id !== checkout || payment.ad_id !== id || payment.user_id !== user!.id || !payment.mpesa_receipt_number || String(payment.result_code) !== '0' || Math.round(Number(payment.amount_kes) * 100) !== amount * 100) throw new Error('Payment completion verification failed');
          const { data: campaign, error: campaignError } = await supabase.from('zenad_campaigns').select('id,payment_status,status,payment_reference').eq('id', id).maybeSingle();
          if (campaignError) throw campaignError;
          if (!campaign || campaign.payment_status !== 'funded' || campaign.payment_reference !== payment.mpesa_receipt_number || campaign.status !== 'active') throw new Error('Verified payment is not yet reflected as an active campaign');
          finalized.current = true; setPaymentStatus('paid'); setStep('success');
          trackTestagramEvent(TestagramEvent.AD_PAYMENT_CONFIRMED, { ad_id:id, campaign_id:id, amount_kes:Number(payment.amount_kes), payment_method:'mpesa', checkout_request_id:checkout, mpesa_receipt_number:payment.mpesa_receipt_number });
          trackTestagramEvent(TestagramEvent.AD_ACTIVATED, { ad_id:id, campaign_id:id, amount_kes:Number(payment.amount_kes), payment_method:'mpesa', checkout_request_id:checkout });
          return;
        }
        if (payment?.status === 'failed') { finalized.current = true; setPaymentStatus('pending'); trackTestagramEvent(TestagramEvent.AD_PAYMENT_FAILED, { ad_id:id, campaign_id:id, amount_kes:Number(payment.amount_kes), payment_method:'mpesa', checkout_request_id:checkout, result_code:payment.result_code }); toast.error('Payment failed.'); return; }
      } catch { /* retry below; payment remains server-authoritative */ }
      attempts += 1;
      if (attempts < 24 && !finalized.current) timer.current = setTimeout(run, 5000); else if (!finalized.current) { setPaymentStatus('pending'); toast.error('Payment verification is taking longer than expected.'); }
    };
    timer.current = setTimeout(run, 5000);
  };

  if (!user) return null;
  if (step === 'success') return <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center"><CheckCircle2 className="w-20 h-20 text-green-500 mb-5"/><h1 className="text-2xl font-bold">Ad is Live</h1><p className="text-muted-foreground mt-2 mb-6">Your campaign passed server-side payment verification and is active.</p><Button onClick={() => navigate('/my-ads')}>View My Ads</Button></div>;
  if (step === 'mpesa') return <div className="min-h-screen"><TopBar title="Pay via M-Pesa" showBack/><div className="max-w-md mx-auto p-6 space-y-5"><div className="rounded-2xl border p-5"><p className="font-bold">Campaign ready</p><p className="text-2xl font-black mt-2">KES {Number(budget).toLocaleString()}</p><p className="text-sm text-muted-foreground mt-1">Campaign: {title}</p></div>{paymentStatus === 'checking' ? <div className="text-center py-10"><Loader2 className="w-8 h-8 animate-spin mx-auto mb-3"/><p className="font-semibold">Waiting for verified payment…</p><p className="text-xs text-muted-foreground mt-2">The campaign activates only after server-side settlement.</p></div> : <><Input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="0712 345 678"/><Button className="w-full py-6" onClick={pay} disabled={loading||!phone.trim()}>{loading?<><Loader2 className="w-5 h-5 animate-spin mr-2"/>Sending…</>:<>Pay KES {Number(budget).toLocaleString()} via M-Pesa</>}</Button></>}</div></div>;
  return <div className="min-h-screen"><TopBar title="Create Advertisement" showBack/><div className="max-w-2xl mx-auto p-6 space-y-5"><div className="rounded-2xl border p-5"><div className="flex items-center gap-3"><Megaphone className="w-7 h-7 text-primary"/><div><h1 className="text-xl font-bold">Create an advertisement</h1><p className="text-sm text-muted-foreground">Your campaign is created through the canonical ZenAd service.</p></div></div></div><Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ad title" maxLength={120}/><Textarea value={description} onChange={e=>setDescription(e.target.value)} placeholder="Describe what you are promoting" maxLength={500}/><Input type="url" value={targetUrl} onChange={e=>setTargetUrl(e.target.value)} placeholder="https://example.com"/><Input type="number" value={budget} onChange={e=>setBudget(e.target.value)} min={MIN_BUDGET_KES} placeholder={`Budget in KES (minimum ${MIN_BUDGET_KES})`}/><div className="border rounded-2xl p-4"><p className="font-semibold mb-3">Target interests</p><div className="flex flex-wrap gap-2">{INTERESTS.map(x=>{const selected=interests.includes(x);return <button type="button" key={x} onClick={()=>setInterests(p=>selected?p.filter(i=>i!==x):[...p,x])} className={`px-3 py-1.5 rounded-full border text-sm ${selected?'border-primary bg-primary/10 text-primary':'border-border'}`}>{x}</button>})}</div></div><div className="flex items-center justify-between border rounded-2xl p-4"><div><p className="font-semibold">Story format</p><p className="text-xs text-muted-foreground">Serve in the Testagram Stories slot.</p></div><button type="button" onClick={()=>setStory(v=>!v)} className="px-4 py-2 rounded-full border">{story?'On':'Off'}</button></div><div className="grid grid-cols-2 gap-3"><Input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/><Input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)}/></div><div className="border-2 border-dashed rounded-2xl p-6 text-center">{preview?<div className="relative"><img src={preview} alt="Ad preview" className="w-full max-h-64 object-contain rounded-xl"/><button type="button" onClick={()=>{setImage(null);setPreview(null)}} className="absolute top-2 right-2 rounded-full bg-black text-white p-2"><X className="w-4 h-4"/></button></div>:<label className="cursor-pointer"><ImageIcon className="w-10 h-10 mx-auto mb-2 text-muted-foreground"/><span className="text-sm">Choose ad image</span><input className="hidden" type="file" accept="image/*" onChange={chooseImage}/></label>}</div><Button className="w-full py-6" onClick={createCampaign} disabled={loading||!title.trim()||!description.trim()||!budget}>{loading?<><Loader2 className="w-5 h-5 animate-spin mr-2"/>Creating campaign…</>:<>Continue to M-Pesa</>}</Button></div></div>;
}
