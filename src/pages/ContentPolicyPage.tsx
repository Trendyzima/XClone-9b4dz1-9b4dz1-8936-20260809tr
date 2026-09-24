import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import {
  Shield, AlertTriangle, Ban, Megaphone, CheckCircle, XCircle,
  MessageSquare, Eye, Flag, Globe, Zap, ChevronDown, FileText,
  Scale, UserRound, FlagTriangleRight, ExternalLink,
} from 'lucide-react';

interface CatDef {
  id: string;
  color: string;
  bg: string;
  title: string;
  desc: string;
  allowed: string[];
  prohibited: string[];
}

const MODERATION_CATEGORIES: CatDef[] = [
  {
    id: 'hate-speech',
    color: 'text-red-500',
    bg: 'bg-red-500/10 border-red-500/20',
    title: 'Hate Speech',
    desc: 'Content targeting people or groups based on protected characteristics.',
    allowed: ['Educational content about discrimination and its impacts', 'News reporting on hate crimes with appropriate context', 'Counter-speech challenging hateful ideologies', 'Personal testimony about discrimination'],
    prohibited: ['Slurs, dehumanizing language, or calls for violence', 'Content portraying protected groups as inferior or subhuman', 'Holocaust denial or glorification of genocide', 'Targeted harassment based on protected characteristics'],
  },
  {
    id: 'harassment',
    color: 'text-orange-500',
    bg: 'bg-orange-500/10 border-orange-500/20',
    title: 'Harassment & Bullying',
    desc: 'Targeted abuse, threats, intimidation, or sustained unwanted behavior.',
    allowed: ['Constructive criticism of public figures and their public actions', 'Satire and parody clearly framed as such', 'Respectful debate and disagreement', 'Accountability for institutions and public figures'],
    prohibited: ['Threats of violence or physical harm', 'Coordinated attacks or pile-ons targeting individuals', 'Doxxing or sharing private personal information', 'Repeated unwanted contact intended to harass or intimidate'],
  },
  {
    id: 'sexual-content',
    color: 'text-pink-500',
    bg: 'bg-pink-500/10 border-pink-500/20',
    title: 'Explicit & Sexual Content',
    desc: 'Sexualized or explicit material, including exploitative or non-consensual imagery.',
    allowed: ['Artistic nudity in clearly educational or museum contexts', 'Medical or health information with clinical imagery', 'Breastfeeding content presented non-sexually', 'Age-appropriate romantic content without explicit acts'],
    prohibited: ['Pornographic or explicit sexual content', 'Content sexualizing minors', 'Non-consensual intimate imagery', 'Soliciting sexual services or sending explicit material to non-consenting users'],
  },
  {
    id: 'violence',
    color: 'text-red-600',
    bg: 'bg-red-600/10 border-red-600/20',
    title: 'Violence & Gore',
    desc: 'Content that promotes, glorifies, or graphically depicts violence or physical harm.',
    allowed: ['News reporting with appropriate warnings and context', 'Documentaries and historical accounts of conflict', 'Fiction that does not glorify real-world violence', 'Self-defense and sports content'],
    prohibited: ['Glorifying or encouraging violence against a person or group', 'Graphic injury or death without legitimate context', 'Terrorist propaganda or promotion of extremist groups', 'Encouraging self-harm or suicide'],
  },
  {
    id: 'spam',
    color: 'text-yellow-600',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
    title: 'Spam & Deceptive Content',
    desc: 'Repetitive, misleading, fraudulent, or manipulative behavior.',
    allowed: ['Promotional content clearly labeled as advertising', 'Sharing your own content across relevant communities', 'Affiliate links disclosed as such', 'Crowdfunding for legitimate personal or community projects'],
    prohibited: ['Mass sending identical or near-identical messages', 'Phishing links or fraudulent financial schemes', 'Buying or selling fake engagement', 'Impersonating users, brands, or organizations'],
  },
  {
    id: 'misinformation',
    color: 'text-amber-600',
    bg: 'bg-amber-500/10 border-amber-600/20',
    title: 'Misinformation',
    desc: 'False or misleading information that may create significant real-world harm.',
    allowed: ['Opinion clearly presented as opinion', 'Satire and parody with obvious fictional framing', 'Discussion of scientific findings with supporting sources', 'Personal health experiences that are not presented as medical advice'],
    prohibited: ['Fabricated medical cures or dangerous health misinformation', 'False information about elections, voting, or electoral processes', 'Doctored media presented as authentic without disclosure', 'Crisis misinformation during emergencies or disasters'],
  },
];

const AD_PROHIBITED_ITEMS = [
  'Nudity, pornography, sexual imagery, or sexually suggestive creative',
  'Violent, gory, or disturbing imagery',
  'Illegal products, services, or substances',
  'Counterfeit or trademark-infringing products',
  'Misleading claims, fake testimonials, or deceptive before/after imagery',
  'Tobacco, cigarettes, or vaping products',
  'Political campaign ads or partisan campaign content',
];

const AD_ENCOURAGED_ITEMS = [
  'Clear, honest descriptions of products and services',
  'Authentic user-generated content used with permission',
  'Accessible language and inclusive imagery',
  'Transparent pricing, material terms, and conditions',
  'A clear call-to-action with a working destination',
  'High-quality creative with readable text and appropriate resolution',
];

const ENFORCEMENT_STEPS = [
  { title: 'Review', desc: 'A report or safety signal may trigger automated screening, prioritisation, or additional review. A signal is not itself a finding of a violation.', icon: 'review' },
  { title: 'Context & decision', desc: 'Where appropriate, reviewers may consider context, severity, repetition, account history, applicable law, and available evidence.', icon: 'context' },
  { title: 'Action', desc: 'Depending on the circumstances, action may include a warning, content removal, feature restriction, account restriction, or suspension.', icon: 'action' },
] as const;

const QUICK_LINKS = [
  { id: 'overview', label: 'Overview' },
  { id: 'categories', label: 'Community standards' },
  { id: 'ads', label: 'Ads' },
  { id: 'enforcement', label: 'Enforcement & appeals' },
  { id: 'transparency', label: 'AI & human review' },
];

const FAQS = [
  ['Can context matter?', 'Yes. Context can be considered when applicable, including whether content is news, educational, artistic, satirical, or otherwise framed in a way that changes its meaning.'],
  ['Can automated systems remove content?', 'Automated systems may screen, detect, prioritise, or restrict some activity. The applicable review process can depend on the type, severity, and confidence of the signal.'],
  ['How do I report something?', 'Use the reporting controls available on the relevant post, profile, message, or advertisement. Include enough context for the moderation team to understand the concern.'],
  ['How do I appeal?', 'Use the Appeals page to submit a clear explanation of why you believe an enforcement action was incorrect. Review timing can vary by case and volume.'],
];

function getStepIconNode(kind: string) {
  if (kind === 'review') return <Flag className="w-5 h-5" />;
  if (kind === 'context') return <Scale className="w-5 h-5" />;
  return <Ban className="w-5 h-5" />;
}

function getCatIconNode(title: string, colorClass: string) {
  if (title === 'Hate Speech') return <AlertTriangle className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Harassment & Bullying') return <MessageSquare className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Explicit & Sexual Content') return <Eye className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Violence & Gore') return <Ban className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Spam & Deceptive Content') return <Zap className={`w-5 h-5 ${colorClass}`} />;
  return <Globe className={`w-5 h-5 ${colorClass}`} />;
}

export default function ContentPolicyPage() {
  useSEO({
    title: 'Content Policy | Testagram',
    description: 'Testagram community standards, advertising rules, enforcement, reporting, and appeals.',
    url: '/policy',
  });
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('overview');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const sectionIds = useMemo(() => QUICK_LINKS.map(link => link.id), []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target instanceof HTMLElement && sectionIds.includes(visible.target.id)) setActiveSection(visible.target.id);
      },
      { rootMargin: '-96px 0px -60% 0px', threshold: [0.1, 0.5, 0.9] },
    );
    sectionIds.forEach(id => {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [sectionIds]);

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveSection(id);
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Content Policy" showBack />
      <main className="max-w-3xl mx-auto px-4 py-5 space-y-6">
        <section id="overview" className="scroll-mt-24">
          <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/12 via-background to-violet-500/10 p-6 sm:p-8">
            <div className="absolute -right-16 -top-16 w-40 h-40 rounded-full bg-primary/10 blur-2xl" />
            <div className="relative">
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-primary"><Shield className="w-3 h-3" /> Community standards</span>
                <span className="text-[10px] text-muted-foreground">Updated September 2026</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-black tracking-tight">Rules for a safe, open Testagram.</h1>
              <p className="mt-3 max-w-2xl text-sm sm:text-base leading-relaxed text-muted-foreground">These standards explain what is allowed, what is restricted, how reports are reviewed, and what options may be available when action is taken.</p>
              <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  ['01', 'Express', 'Share ideas, creativity, news, and opinion.'],
                  ['02', 'Respect', 'Disagree without threats, abuse, or targeting.'],
                  ['03', 'Report', 'Flag content that may violate these standards.'],
                ].map(([num, title, text]) => (
                  <div key={num} className="rounded-2xl border border-border/70 bg-background/70 p-3">
                    <p className="text-[10px] font-black text-primary">{num}</p>
                    <p className="mt-1 text-sm font-black">{title}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <nav aria-label="Policy sections" className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-background/95 backdrop-blur border-y border-border/60">
          <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
            {QUICK_LINKS.map(link => (
              <button key={link.id} onClick={() => jumpTo(link.id)} aria-current={activeSection === link.id ? 'page' : undefined} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${activeSection === link.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'}`}>
                {link.label}
              </button>
            ))}
          </div>
        </nav>

        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-start gap-3">
            <FileText className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="font-black">How to read this policy</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Examples are illustrative, not exhaustive. Whether content violates a standard can depend on context, severity, repetition, and other relevant information. These standards should be read together with the Terms, Privacy Policy, and applicable product rules.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => navigate('/terms')} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Terms <ExternalLink className="w-3 h-3" /></button>
                <button onClick={() => navigate('/privacy')} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Privacy <ExternalLink className="w-3 h-3" /></button>
                <button onClick={() => navigate('/help')} className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">Help Center <ExternalLink className="w-3 h-3" /></button>
              </div>
            </div>
          </div>
        </section>

        <section id="categories" className="scroll-mt-24 space-y-4">
          <div>
            <h2 className="text-xl font-black">Community standards</h2>
            <p className="mt-1 text-sm text-muted-foreground">Automated safety systems may help detect and prioritise potential issues. Signals can be reviewed with context, available evidence, applicable law, and the relevant moderation process.</p>
          </div>
          <div className="grid gap-4">
            {MODERATION_CATEGORIES.map(cat => (
              <article key={cat.id} className={`overflow-hidden rounded-2xl border ${cat.bg}`}>
                <div className="flex items-start gap-3 px-5 py-4">
                  <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${cat.bg}`}>{getCatIconNode(cat.title, cat.color)}</div>
                  <div className="min-w-0">
                    <h3 className={`font-black ${cat.color}`}>{cat.title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{cat.desc}</p>
                  </div>
                </div>
                <div className="grid gap-4 border-t border-current/10 bg-background/70 px-5 py-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-green-600"><CheckCircle className="w-3 h-3" /> Examples generally allowed</p>
                    <ul className="space-y-1.5">{cat.allowed.map(item => <li key={item} className="flex gap-2 text-xs leading-relaxed text-muted-foreground"><span className="mt-1 text-green-500">•</span><span>{item}</span></li>)}</ul>
                  </div>
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-red-600"><XCircle className="w-3 h-3" /> Examples prohibited</p>
                    <ul className="space-y-1.5">{cat.prohibited.map(item => <li key={item} className="flex gap-2 text-xs leading-relaxed text-muted-foreground"><span className="mt-1 text-red-500">•</span><span>{item}</span></li>)}</ul>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="ads" className="scroll-mt-24 space-y-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black"><Megaphone className="w-5 h-5 text-primary" /> Advertising standards</h2>
            <p className="mt-1 text-sm text-muted-foreground">Ads may receive automated screening and additional review. Actions can include rejection, removal, account restrictions, or advertising restrictions depending on the issue.</p>
          </div>
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
            <p className="text-[10px] font-black uppercase tracking-wide text-red-600">Strictly prohibited</p>
            <p className="mt-1 text-sm font-bold">Sexual and explicit advertising is not permitted.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Ads involving sexual imagery or explicit sexual content may be rejected and may trigger additional account or advertising review.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { title: 'Never allowed', items: AD_PROHIBITED_ITEMS, color: 'text-red-600', icon: XCircle },
              { title: 'Good advertising practice', items: AD_ENCOURAGED_ITEMS, color: 'text-green-600', icon: CheckCircle },
            ].map(({ title, items, color, icon: Icon }) => (
              <div key={title} className="rounded-2xl border border-border bg-card p-5">
                <p className={`mb-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide ${color}`}><Icon className="w-3.5 h-3.5" />{title}</p>
                <ul className="space-y-2">{items.map(item => <li key={item} className="flex gap-2 text-xs leading-relaxed text-muted-foreground"><Icon className="mt-0.5 h-3 w-3 shrink-0" />{item}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <section id="enforcement" className="scroll-mt-24 space-y-4">
          <div>
            <h2 className="text-xl font-black">Enforcement & appeals</h2>
            <p className="mt-1 text-sm text-muted-foreground">There is not always a fixed sequence of actions. The response can depend on the nature, severity, repetition, and context of the issue.</p>
          </div>
          <div className="grid gap-3">
            {ENFORCEMENT_STEPS.map((step, index) => {
              return <div key={step.title} className="flex gap-4 rounded-2xl border border-border bg-card p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{getStepIconNode(step.icon)}</div>
                <div><p className="text-sm font-black">{index + 1}. {step.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.desc}</p></div>
              </div>;
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => navigate('/appeals')} className="rounded-2xl border border-primary/20 bg-primary/5 p-5 text-left hover:bg-primary/10">
              <FlagTriangleRight className="w-5 h-5 text-primary" />
              <p className="mt-2 text-sm font-black">Appeal a decision</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Open the appeals workflow and explain why you believe an action was incorrect.</p>
            </button>
            <button onClick={() => navigate('/help')} className="rounded-2xl border border-border bg-card p-5 text-left hover:bg-muted">
              <UserRound className="w-5 h-5 text-primary" />
              <p className="mt-2 text-sm font-black">Need help reporting?</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Use the Help Center for reporting and account-support guidance.</p>
            </button>
          </div>
        </section>

        <section id="transparency" className="scroll-mt-24 space-y-4">
          <div className="rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-primary/5 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 mt-0.5 text-violet-600 shrink-0" />
              <div>
                <h2 className="text-xl font-black">AI + human review</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Testagram may combine automated detection, user reports, safety signals, and human review. Automated systems are used to assist screening and prioritisation; they are not described here as infallible or as the sole basis for every decision.</p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[['Detection', 'Automated signals'], ['Context', 'May be considered'], ['Appeals', 'Available where provided'], ['Timing', 'Varies by case']].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-background/60 p-3 text-center"><p className="text-xs font-black">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{label}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-lg font-black">Common questions</h2>
          <div className="mt-2 divide-y divide-border">
            {FAQS.map(([question, answer], index) => {
              const open = openFaq === index;
              return <div key={question}>
                <button onClick={() => setOpenFaq(open ? null : index)} className="flex w-full items-center justify-between gap-4 py-4 text-left" aria-expanded={open}>
                  <span className="text-sm font-bold">{question}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && <p className="pb-4 pr-8 text-xs leading-relaxed text-muted-foreground">{answer}</p>}
              </div>;
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-muted/30 p-5">
          <h2 className="text-sm font-black">Policy scope & records</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">These standards apply to activity on Testagram where relevant. Moderation records may be retained for safety, security, dispute resolution, enforcement integrity, and legal obligations, subject to applicable retention practices and law.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => navigate('/privacy')} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-muted">Privacy & data</button>
            <button onClick={() => navigate('/terms')} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold hover:bg-muted">Terms</button>
            <button onClick={() => navigate('/appeals')} className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/15">Appeals</button>
          </div>
        </section>

        <footer className="border-t border-border pt-5 text-center">
          <p className="text-xs text-muted-foreground">Questions about this policy? Use the Help Center or available support channels in Testagram.</p>
          <p className="mt-2 text-[10px] text-muted-foreground">Last updated: September 2026 · Testagram Safety & Policy Team</p>
        </footer>
      </main>
    </div>
  );
}
