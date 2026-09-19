import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { FileText, Users, CreditCard, Shield, AlertTriangle, Scale, Globe, Handshake } from 'lucide-react';

// Module-level data (esbuild guard: no inline arrays in render)
interface TermsSection {
  iconColor: string;
  iconBg: string;
  title: string;
  points: string[];
}

// esbuild guard: module-level helper — no `const Icon = section.icon` inside .map()
function getTermsIconNode(title: string, colorClass: string) {
  if (title === '1. Eligibility & Account')           return <Users className={`w-5 h-5 ${colorClass}`} />;
  if (title === '2. Content & Intellectual Property') return <FileText className={`w-5 h-5 ${colorClass}`} />;
  if (title === '3. Payments & Creator Earnings')     return <CreditCard className={`w-5 h-5 ${colorClass}`} />;
  if (title === '4. Prohibited Conduct')              return <Shield className={`w-5 h-5 ${colorClass}`} />;
  if (title === '5. Enforcement & Termination')       return <AlertTriangle className={`w-5 h-5 ${colorClass}`} />;
  if (title === '6. Disclaimers & Limitation of Liability') return <Scale className={`w-5 h-5 ${colorClass}`} />;
  if (title === '7. Governing Law')                   return <Globe className={`w-5 h-5 ${colorClass}`} />;
  return <Handshake className={`w-5 h-5 ${colorClass}`} />;
}

const TERMS_SECTIONS: TermsSection[] = [
  {
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-500/10',
    title: '1. Eligibility & Account',
    points: [
      'Testagram is intended for adults. If a person under 18 is permitted to use the service, required age-verification and verifiable parent or guardian consent must be obtained before processing their personal data, as required by applicable law.',
      'You may maintain accounts only as permitted by the product. Creating accounts to evade enforcement, impersonate others, abuse promotions, or circumvent security controls is prohibited.',
      'You are responsible for keeping your login credentials secure. Do not share your password with anyone.',
      'You must provide accurate information when creating your account. Impersonating another person or entity is prohibited.',
      'We reserve the right to suspend or terminate accounts that violate these Terms.',
    ],
  },
  {
    iconColor: 'text-green-600',
    iconBg: 'bg-green-500/10',
    title: '2. Content & Intellectual Property',
    points: [
      'You retain ownership of all content you post on Testagram (posts, videos, photos, threads).',
      'By posting content, you grant Testagram a limited, non-exclusive, worldwide, royalty-free licence to host, reproduce, process, display, and distribute that content as necessary to operate, secure, moderate, and improve the service. The licence ends for deleted content when it is removed from active systems, except where retention is required by law, safety, dispute resolution, backups, or other legitimate purposes.',
      'You confirm that you have the rights to post any content you share, including music, images, and videos.',
      'Testagram\'s trademarks, logos, and platform code are the exclusive property of T Social Ltd and may not be reproduced without permission.',
      'You may not scrape, crawl, or extract data from Testagram without explicit written permission from T Social Ltd.',
      'If you believe your copyrighted work has been posted without permission, contact us at copyright@tsocial.com.',
    ],
  },
  {
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-500/10',
    title: '3. Payments & Creator Earnings',
    points: [
      'Wallet balances and payment functionality are subject to the applicable product terms, transaction status, verification requirements, fraud controls, and withdrawal limits displayed in the service. A wallet balance should not be treated as a bank deposit or guarantee of funds unless expressly stated in a separate agreement.',
      'Creator earnings, including advertising revenue, tips, subscriptions, and other eligible programs, are calculated and distributed according to the applicable creator or monetization terms shown when the feature is enabled. Rates and revenue shares may change prospectively with notice where required.',
      'Any applicable platform, payment, conversion, or withdrawal fee will be disclosed in the relevant transaction flow before confirmation.',
      'All M-Pesa transactions are processed in KES by Safaricom\'s M-Pesa service. Exchange rates apply for USD conversions.',
      'Testagram is not responsible for failed M-Pesa transactions due to network issues outside our control. Failed transactions are automatically reversed within 24 hours.',
      'Payout eligibility, minimum thresholds, supported payout methods, and processing times are displayed in the applicable wallet or creator-earnings flow and may change.',
      'We reserve the right to withhold earnings pending investigation if fraud or Terms violations are suspected.',
    ],
  },
  {
    iconColor: 'text-red-600',
    iconBg: 'bg-red-500/10',
    title: '4. Prohibited Conduct',
    points: [
      'Posting hate speech, harassment, threats, graphic violence, or sexually explicit content.',
      'Spreading misinformation that could cause real-world harm (medical, electoral, crisis misinformation).',
      'Creating fake accounts, buying followers/likes, or using bots to artificially inflate engagement.',
      'Attempting to access other users\' accounts or data without authorisation.',
      'Using Testagram to conduct fraud, phishing, or illegal financial activities.',
      'Posting content that infringes the intellectual property rights of others.',
      'Using automated tools to post, like, or interact with content at scale without prior written permission.',
    ],
  },
  {
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-500/10',
    title: '5. Enforcement & Termination',
    points: [
      'Violations of these Terms may result in content removal, account restrictions, or permanent termination.',
      'Enforcement is proportionate to the severity, frequency, context, and potential harm of a violation and may include warnings, content removal, feature restrictions, temporary suspension, or permanent suspension. Some severe violations may result in immediate action.',
      'You may appeal any enforcement action at testagram.site/appeals within 30 days of the action.',
      'We may restrict or terminate access where reasonably necessary to enforce these Terms, protect users or the service, comply with law, address fraud or security risks, or respond to serious or repeated violations. Where appropriate, we will provide notice and available appeal or review mechanisms.',
      'Upon termination, your right to use the platform ceases immediately. Content may be removed within 30 days.',
    ],
  },
  {
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-500/10',
    title: '6. Disclaimers & Limitation of Liability',
    points: [
      'Testagram is provided "as is" without warranties of any kind, express or implied.',
      'We do not guarantee that the platform will be available 100% of the time or that it will be error-free.',
      'To the maximum extent permitted by law, T Social Ltd\'s total liability for any claim arising from your use of Testagram shall not exceed the greater of KES 5,000 or the amount you paid us in the past 12 months.',
      'We are not responsible for the content posted by other users. User-generated content does not represent the views of Testagram.',
      'We are not liable for any losses resulting from unauthorised access to your account if caused by your failure to keep credentials secure.',
    ],
  },
  {
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-500/10',
    title: '7. Governing Law',
    points: [
      'These Terms are governed by the laws of the Republic of Kenya, subject to any mandatory consumer or other rights that apply to you.',
      'Disputes will be handled through the complaint, support, and appeal mechanisms made available by Testagram and, where unresolved, through a competent forum under applicable law.',
      'If you are accessing Testagram from outside Kenya, you agree that Kenyan law applies.',
      'Nothing in these Terms affects any statutory rights you have as a consumer under applicable local law.',
    ],
  },
  {
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-500/10',
    title: '8. Changes to These Terms',
    points: [
      'We may update these Terms to reflect product, security, legal, or operational changes. For material changes, we will provide notice and any legally required advance period before the changes take effect.',
      'Continuing to use Testagram after a change takes effect constitutes acceptance of the new Terms.',
      'If you do not agree with an update, you may delete your account before the new Terms take effect.',
      'The most recent version of these Terms is always available at testagram.site/terms.',
      'Questions about these Terms? Contact us at legal@tsocial.com.',
    ],
  },
];

export default function TermsOfServicePage() {
  useSEO({
    title: 'Terms of Service | Testagram',
    description: 'Read Testagram\'s Terms of Service — your rights, responsibilities, and our rules for using the platform.',
    url: '/terms',
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Terms of Service" showBack />

      <div className="max-w-2xl mx-auto p-4 space-y-6">

        {/* Hero */}
        <div className="bg-gradient-to-br from-indigo-500/10 via-background to-purple-500/5 border border-indigo-500/20 rounded-2xl p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-9 h-9 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-black mb-2">Terms of Service</h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            By using Testagram you agree to these terms. Please read them carefully — they explain your rights, our obligations, and how the platform works.
          </p>
          <p className="text-[11px] text-muted-foreground mt-3 opacity-70">Last updated: September 2026 · Effective immediately</p>
        </div>

        {/* Summary */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-black text-base mb-3 flex items-center gap-2">
            <span className="text-lg">📋</span> Key Points Summary
          </h2>
          <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
            <p>✅ You own your content — we only display it.</p>
            <p>✅ Creator earnings are paid out per our published revenue share model.</p>
            <p>✅ You can delete your account and data at any time.</p>
            <p>⚠️ Violations of our rules can result in account restrictions.</p>
            <p>⚠️ These terms are governed by the laws of Kenya.</p>
          </div>
        </div>

        {/* Terms sections */}
        {TERMS_SECTIONS.map((section) => (
            <div key={section.title} className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/20">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${section.iconBg}`}>
                  {getTermsIconNode(section.title, section.iconColor)}
                </div>
                <h2 className="font-black text-sm">{section.title}</h2>
              </div>
              <ul className="px-5 py-4 space-y-2.5">
                {section.points.map((point, pi) => (
                  <li key={pi} className="flex items-start gap-2.5 text-sm text-muted-foreground leading-relaxed">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
        ))}

        {/* Footer note */}
        <div className="text-center pb-4">
          <p className="text-xs text-muted-foreground">
            For legal enquiries, contact{' '}
            <a href="mailto:legal@tsocial.com" className="text-primary hover:underline font-semibold">legal@tsocial.com</a>
          </p>
          <p className="text-[10px] text-muted-foreground mt-2 opacity-60">© 2026 T Social Ltd. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
