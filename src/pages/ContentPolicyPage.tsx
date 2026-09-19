import { useNavigate } from 'react-router-dom';
import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import {
  Shield, AlertTriangle, Ban, Megaphone, CheckCircle, XCircle,
  MessageSquare, Eye, Flag, Globe, Zap,
} from 'lucide-react';

// ── Module-level data — NO `as const`, NO icon lookups in render (esbuild guard) ──

interface CatDef {
  color: string;
  bg: string;
  title: string;
  desc: string;
  allowed: string[];
  prohibited: string[];
}

const MODERATION_CATEGORIES: CatDef[] = [
  {
    color: 'text-red-500',
    bg: 'bg-red-500/10 border-red-500/20',
    title: 'Hate Speech',
    desc: 'Content targeting race, religion, gender, sexual orientation, ethnicity, or national origin.',
    allowed: [
      'Educational content about discrimination and its impacts',
      'News reporting on hate crimes with appropriate context',
      'Counter-speech that challenges hateful ideologies',
      'Personal testimony about experiences of discrimination',
    ],
    prohibited: [
      'Slurs, dehumanizing language, or calls for violence',
      'Content portraying groups as subhuman or inferior',
      'Holocaust denial or glorification of genocide',
      'Targeted harassment based on protected characteristics',
    ],
  },
  {
    color: 'text-orange-500',
    bg: 'bg-orange-500/10 border-orange-500/20',
    title: 'Harassment & Bullying',
    desc: 'Direct attacks, threats, or sustained targeted behavior against individuals.',
    allowed: [
      'Constructive criticism of public figures and their public actions',
      'Satire and parody clearly labeled as such',
      'Debate and disagreement expressed respectfully',
      'Holding institutions and public figures accountable',
    ],
    prohibited: [
      'Threats of violence or physical harm',
      'Coordinated attacks or pile-ons targeting individuals',
      'Doxxing — sharing private personal information',
      'Sending repeated unwanted messages to block contacts',
    ],
  },
  {
    color: 'text-pink-500',
    bg: 'bg-pink-500/10 border-pink-500/20',
    title: 'Explicit & Sexual Content',
    desc: 'Nudity, pornography, or sexual content. Testagram has a zero-tolerance policy.',
    allowed: [
      'Artistic nudity in clearly educational/museum contexts',
      'Medical or health information with clinical imagery',
      'Breastfeeding content presented non-sexually',
      'Age-appropriate romantic content (no explicit acts)',
    ],
    prohibited: [
      'Nudity, pornographic, or explicit sexual content of any kind',
      'Content sexualizing minors — immediate permanent ban',
      'Non-consensual intimate imagery (revenge porn)',
      'Soliciting sexual services or explicit DMs to non-consenting users',
    ],
  },
  {
    color: 'text-red-600',
    bg: 'bg-red-600/10 border-red-600/20',
    title: 'Violence & Gore',
    desc: 'Content that promotes, glorifies, or graphically depicts violence or physical harm.',
    allowed: [
      'News reporting with appropriate content warnings',
      'Documentaries and historical accounts of conflict',
      'Fiction that does not glorify real-world violence',
      'Self-defense and sports content',
    ],
    prohibited: [
      'Glorifying or encouraging violence against any person or group',
      'Graphic imagery of injury or death without news/educational context',
      'Terrorist propaganda or promotion of extremist groups',
      'Encouraging self-harm or suicide',
    ],
  },
  {
    color: 'text-yellow-600',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
    title: 'Spam & Deceptive Content',
    desc: 'Repetitive, misleading, or fraudulent content designed to deceive users.',
    allowed: [
      'Promotional content clearly labeled as an advertisement',
      'Sharing your own content across relevant communities',
      'Affiliate links disclosed as such in the post',
      'Crowdfunding for verified personal or community projects',
    ],
    prohibited: [
      'Mass sending identical or near-identical messages',
      'Phishing links or fraudulent financial schemes',
      'Fake engagement (buying/selling followers, likes, views)',
      'Impersonating other users, brands, or organizations',
    ],
  },
  {
    color: 'text-amber-600',
    bg: 'bg-amber-500/10 border-amber-500/20',
    title: 'Misinformation',
    desc: 'False or misleading information that could cause real-world harm.',
    allowed: [
      'Opinion pieces clearly labeled as personal views',
      'Satire and parody with obvious fictional framing',
      'Discussion and debate of scientific findings with citations',
      'Personal health experiences (not presented as medical advice)',
    ],
    prohibited: [
      'Fabricated medical cures or anti-vaccine misinformation',
      'False information about elections, voting, or electoral processes',
      'Doctored media presented as authentic without disclosure',
      'Crisis misinformation during emergencies or disasters',
    ],
  },
];

// Pure module-level helper — returns icon JSX for a category (esbuild guard: no const Icon in render)
function getCatIconNode(title: string, colorClass: string) {
  if (title === 'Hate Speech')             return <AlertTriangle className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Harassment & Bullying')   return <MessageSquare className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Explicit & Sexual Content') return <Eye className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Violence & Gore')         return <Ban className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Spam & Deceptive Content') return <Zap className={`w-5 h-5 ${colorClass}`} />;
  return <Globe className={`w-5 h-5 ${colorClass}`} />;
}

interface AdRule { color: string; label: string; isProhibited: boolean; items: string[] }

const AD_PROHIBITED_ITEMS = [
  'Nudity, sexual imagery, or suggestive content of any kind',
  'Violent, gory, or disturbing imagery',
  'Illegal products, services, or substances',
  'Counterfeit or trademark-infringing products',
  'Misleading claims, fake testimonials, or false "before/after" imagery',
  'Tobacco, cigarettes, or vaping products',
  'Political campaign ads or partisan content',
];

const AD_ENCOURAGED_ITEMS = [
  'Clear, honest description of the product or service',
  'Authentic user-generated content with permission',
  'Accessible language and inclusive imagery',
  'Transparent pricing and terms',
  'Strong call-to-action with a working destination URL',
  'High-quality images (minimum 800px wide, no excessive text overlay)',
];

const AD_RULES: AdRule[] = [
  { color: 'text-red-500',   label: 'Never Allowed in Ads', isProhibited: true,  items: AD_PROHIBITED_ITEMS },
  { color: 'text-green-500', label: 'Encouraged in Ads',    isProhibited: false, items: AD_ENCOURAGED_ITEMS },
];

interface StepDef { step: string; color: string; bg: string; title: string; desc: string }

const ENFORCEMENT_STEPS: StepDef[] = [
  { step: '1', color: 'text-orange-500', bg: 'bg-orange-500/10', title: 'First Enforcement Action',  desc: 'Possible warning, content removal, or temporary feature restriction, depending on severity.' },
  { step: '2', color: 'text-red-500',    bg: 'bg-red-500/10',    title: 'Further Enforcement', desc: 'Additional or longer restriction may apply. Appeal or review may be available via /appeals.' },
  { step: '3', color: 'text-red-700',    bg: 'bg-red-700/10',    title: 'Severe or Repeated Violations',  desc: 'Severe or repeated violations may result in permanent suspension, subject to applicable review or appeal procedures.' },
];

// Pure helper — returns icon JSX for enforcement step (esbuild guard)
function getStepIconNode(step: string, colorClass: string) {
  if (step === '1') return <Flag className={`w-5 h-5 ${colorClass}`} />;
  if (step === '2') return <AlertTriangle className={`w-5 h-5 ${colorClass}`} />;
  return <Ban className={`w-5 h-5 ${colorClass}`} />;
}

export default function ContentPolicyPage() {
  useSEO({
    title: 'Content Policy | Testagram',
    description: 'Testagram content moderation guidelines, ad policies, and enforcement procedures.',
    url: '/policy',
  });
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Content Policy" showBack />

      <div className="max-w-2xl mx-auto p-4 space-y-8">

        {/* Hero */}
        <div className="bg-gradient-to-br from-primary/10 via-background to-violet-500/5 border border-primary/20 rounded-2xl p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-9 h-9 text-primary" />
          </div>
          <h1 className="text-2xl font-black mb-2">Community Content Policy</h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            Testagram is built for authentic human connection. These guidelines explain the standards we apply to protect safety, privacy, lawful participation, and meaningful expression.
          </p>
          <div className="flex justify-center gap-2 mt-4 flex-wrap">
            <span className="text-[10px] bg-green-500/10 text-green-600 font-bold px-2.5 py-1 rounded-full border border-green-500/20">AI-Powered Enforcement</span>
            <span className="text-[10px] bg-primary/10 text-primary font-bold px-2.5 py-1 rounded-full border border-primary/20">Human Regulator Review</span>
            <span className="text-[10px] bg-orange-500/10 text-orange-600 font-bold px-2.5 py-1 rounded-full border border-orange-500/20">Appeals Process</span>
          </div>
        </div>

        {/* TL;DR */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-black text-base mb-3 flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" />Quick Summary
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { ok: true,  text: 'Express opinions freely' },
              { ok: true,  text: 'Share art and creativity' },
              { ok: true,  text: 'Debate and disagree' },
              { ok: true,  text: 'Report news and events' },
              { ok: false, text: 'Hate speech or slurs' },
              { ok: false, text: 'Explicit sexual content' },
              { ok: false, text: 'Harassment or threats' },
              { ok: false, text: 'Dangerous misinformation' },
            ].map((item, i) => (
              <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold ${item.ok ? 'bg-green-500/8 text-green-700 dark:text-green-400' : 'bg-red-500/8 text-red-700 dark:text-red-400'}`}>
                {item.ok ? <CheckCircle className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                {item.text}
              </div>
            ))}
          </div>
        </div>

        {/* Moderation Categories */}
        <div className="space-y-4">
          <h2 className="font-black text-lg">Moderation Categories</h2>
          <p className="text-sm text-muted-foreground -mt-2">
            Automated safety systems may assist with screening and prioritisation across multiple harm categories. Automated signals are not the sole basis for every enforcement decision; human review, appeals, context, severity, and applicable law may be considered.
          </p>

          {/* Score bands */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { range: 'Review', label: 'Automated signal', bg: 'bg-green-500/8 border-green-500/20', text: 'text-green-600' },
              { range: 'Context', label: 'Human review', bg: 'bg-orange-500/8 border-orange-500/20', text: 'text-orange-600' },
              { range: 'Action', label: 'Enforcement', bg: 'bg-red-500/8 border-red-500/20', text: 'text-red-600' },
            ].map(b => (
              <div key={b.range} className={`p-3 rounded-xl border text-center ${b.bg}`}>
                <p className={`font-black text-sm ${b.text}`}>{b.range}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{b.label}</p>
              </div>
            ))}
          </div>

          {MODERATION_CATEGORIES.map(cat => (
            <div key={cat.title} className={`border rounded-2xl overflow-hidden ${cat.bg}`}>
              <div className="px-5 py-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cat.bg}`}>
                  {getCatIconNode(cat.title, cat.color)}
                </div>
                <div>
                  <h3 className={`font-black text-sm ${cat.color}`}>{cat.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{cat.desc}</p>
                </div>
              </div>
              <div className="bg-background/70 border-t border-current/10 px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-black text-green-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />Allowed
                  </p>
                  <ul className="space-y-1">
                    {cat.allowed.map((item, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                        <span className="text-green-500 shrink-0 mt-0.5">•</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] font-black text-red-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                    <XCircle className="w-3 h-3" />Prohibited
                  </p>
                  <ul className="space-y-1">
                    {cat.prohibited.map((item, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                        <span className="text-red-500 shrink-0 mt-0.5">•</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Advertisement Policy */}
        <div className="space-y-4">
          <h2 className="font-black text-lg flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />Advertisement Policy
          </h2>
          <p className="text-sm text-muted-foreground">
            Advertisements may be automatically screened for prohibited or deceptive content and may receive additional review. Enforcement can include rejection, removal, account restrictions, or advertising restrictions depending on the issue.
          </p>
          <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4">
            <p className="text-xs font-black text-red-600 uppercase tracking-wide mb-2">🚫 ZERO TOLERANCE</p>
            <p className="text-sm font-bold">No nudity, pornography, or sexual content in advertisements — ever.</p>
            <p className="text-xs text-muted-foreground mt-1">Any ad containing sexual imagery is automatically rejected and the account flagged for review. Repeat violations result in a permanent advertising ban.</p>
          </div>
          {AD_RULES.map(section => (
            <div key={section.label} className="bg-card border border-border rounded-2xl p-4">
              <p className={`text-xs font-black uppercase tracking-wide mb-3 flex items-center gap-1.5 ${section.color}`}>
                {section.isProhibited
                  ? <XCircle className="w-3.5 h-3.5" />
                  : <CheckCircle className="w-3.5 h-3.5" />}
                {section.label}
              </p>
              <ul className="space-y-1.5">
                {section.items.map((item, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-2">
                    {section.isProhibited
                      ? <XCircle className={`w-3 h-3 shrink-0 mt-0.5 ${section.color}`} />
                      : <CheckCircle className={`w-3 h-3 shrink-0 mt-0.5 ${section.color}`} />}
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Enforcement */}
        <div className="space-y-4">
          <h2 className="font-black text-lg">Enforcement & Strikes</h2>
          <div className="space-y-3">
            {ENFORCEMENT_STEPS.map(step => (
              <div key={step.step} className="flex items-start gap-4 p-4 bg-card border border-border rounded-2xl">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${step.bg}`}>
                  {getStepIconNode(step.step, step.color)}
                </div>
                <div>
                  <p className="font-black text-sm">{step.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl">
            <p className="text-xs font-bold text-primary mb-1">🔄 Appeals Process</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You can appeal any restriction at{' '}
              <button onClick={() => navigate('/appeals')} className="text-primary font-semibold hover:underline">
                testagram.site/appeals
              </button>.
              Include a clear explanation of why you believe the restriction was applied in error. Appeals are reviewed using the applicable moderation process; timing can vary with case complexity and volume.
            </p>
          </div>
        </div>

        {/* AI Moderation transparency */}
        <div className="bg-gradient-to-br from-violet-500/8 to-primary/5 border border-violet-500/20 rounded-2xl p-5">
          <h2 className="font-black text-base mb-3 flex items-center gap-2">
            <Shield className="w-5 h-5 text-violet-600" />AI + Human Moderation
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Testagram uses a multi-layer moderation system that may combine automated detection, user reports, safety signals, and human review. Automated systems help identify and prioritise potentially harmful content, while enforcement can take account of context, severity, repetition, appeals, and applicable law. Moderation records may be retained for safety, security, dispute resolution, and legal purposes.
          </p>
          <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
            {[
              { label: 'Screening', val: 'Automated + human' },
              { label: 'Context', val: 'Considered' },
              { label: 'Appeals', val: 'Available where provided' },
              { label: 'Review Time', val: 'Varies by case' },
            ].map(s => (
              <div key={s.label} className="bg-background/60 rounded-xl p-2.5 text-center">
                <p className="font-black text-sm">{s.val}</p>
                <p className="text-muted-foreground text-[10px] mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div className="text-center pb-4">
          <p className="text-xs text-muted-foreground">
            Questions about this policy? Contact the platform at{' '}
            <a href="mailto:support@tsocial.com" className="text-primary hover:underline font-semibold">contact@onspace.ai</a>
          </p>
          <p className="text-[10px] text-muted-foreground mt-2 opacity-60">Last updated: September 2026 · Testagram Safety & Policy Team</p>
        </div>
      </div>
    </div>
  );
}
