import { useSEO } from '@/hooks/useSEO';
import { TopBar } from '@/components/layout/TopBar';
import { Shield, Eye, Lock, Database, Globe, Mail, Trash2, RefreshCw, UserCheck } from 'lucide-react';

// Module-level data (esbuild guard: no inline arrays in render)
interface PolicySection {
  iconColor: string;
  iconBg: string;
  title: string;
  points: string[];
}

// esbuild guard: module-level helper — no `const Icon = section.icon` inside .map()
function getPolicyIconNode(title: string, colorClass: string) {
  if (title === 'Information We Collect')  return <Database className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'How We Use Your Information') return <Eye className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Information Sharing')     return <Globe className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Data Security')           return <Lock className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Your Rights & Choices')   return <UserCheck className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Cookies & Tracking')      return <RefreshCw className={`w-5 h-5 ${colorClass}`} />;
  if (title === 'Data Retention')          return <Trash2 className={`w-5 h-5 ${colorClass}`} />;
  return <Mail className={`w-5 h-5 ${colorClass}`} />;
}

const POLICY_SECTIONS: PolicySection[] = [
  {
    iconColor: 'text-blue-600',
    iconBg: 'bg-blue-500/10',
    title: 'Information We Collect',
    points: [
      'Account information: username, email address or phone number where provided, profile photo, bio, and optional profile details such as website and location.',
      'Content you create: posts, replies, threads, videos, polls, messages, and media you upload. Media is stored through our designated media-storage infrastructure rather than the application database.',
      'Usage data: pages visited, features used, approximate activity timestamps, interactions with posts and other users, and security events needed to operate the service.',
      'Device & technical data: IP address and request/security metadata, browser or app information, operating system, device identifiers where available, and diagnostic information.',
      'Payment information: transaction references and payment-account details needed to reconcile payments and payouts. Payment providers may separately collect and process payment credentials under their own terms and privacy notices.',
      'Communications: messages you send to our support team and any feedback you provide.',
    ],
  },
  {
    iconColor: 'text-purple-600',
    iconBg: 'bg-purple-500/10',
    title: 'How We Use Your Information',
    points: [
      'To provide, maintain, and improve the Testagram platform and its features.',
      'To personalise your feed and content recommendations based on your interests and activity.',
      'To process payments, handle creator earnings distributions, and prevent fraud.',
      'To send you notifications about activity on your account (likes, replies, new followers, etc.).',
      'To enforce our Community Guidelines and Content Policy — including automated moderation.',
      'To respond to your support requests and communicate important platform updates.',
      'To generate anonymised, aggregated analytics that help us improve the platform.',
    ],
  },
  {
    iconColor: 'text-green-600',
    iconBg: 'bg-green-500/10',
    title: 'Information Sharing',
    points: [
      'We do not sell personal data to third parties for their independent advertising or data-broker use.',
      'Public profile information and public content may be visible to other users and, where applicable, search engines. Privacy and discovery controls can limit some visibility.',
      'We share data with trusted service providers (cloud infrastructure, payment processors) only as needed to operate the platform.',
      'We may disclose information to comply with legal obligations, court orders, or to protect the safety of our users.',
      'In the event of a business transfer, user data may be transferred as part of that transaction with advance notice to users.',
      'Aggregated, anonymised data may be shared for research or business intelligence purposes.',
    ],
  },
  {
    iconColor: 'text-red-600',
    iconBg: 'bg-red-500/10',
    title: 'Data Security',
    points: [
      'We use transport encryption and access controls appropriate to the service, including database row-level security and restricted production access. Exact cryptographic implementations may vary by service provider and infrastructure layer.',
      'Production access is restricted through role-based permissions and administrative security controls.',
      'We use Row-Level Security (RLS) policies in our database so users can only access their own private data.',
      'Payment credentials are handled by PCI-compliant processors — we never store raw card data.',
      'Security incidents are investigated immediately; affected users are notified within 72 hours if required by law.',
      'We continuously monitor and harden the platform and review security controls as the service evolves.',
    ],
  },
  {
    iconColor: 'text-amber-600',
    iconBg: 'bg-amber-500/10',
    title: 'Your Rights & Choices',
    points: [
      'Access: you can request access to personal data we hold about you.',
      'Correction: update available profile information and request correction of inaccurate personal data.',
      'Deletion: you may request deletion of personal data, subject to applicable law, legitimate retention requirements, transaction records, backups, and safety/legal needs.',
      'Data portability and other data-subject requests can be made through support or the privacy contact below.',
      'Opt-out of personalisation: disable "Personalised Feed" in Settings → Feed & Personalisation.',
      'Marketing communications: unsubscribe from any marketing email using the link in the footer.',
    ],
  },
  {
    iconColor: 'text-indigo-600',
    iconBg: 'bg-indigo-500/10',
    title: 'Cookies & Tracking',
    points: [
      'We use essential browser or device storage needed for authentication, security, session continuity, and preferences.',
      'Where analytics are enabled, we use aggregated or pseudonymised usage information to understand reliability and product usage.',
      'We do not intentionally use third-party advertising cookies for cross-site behavioral advertising; individual integrations may have their own policies.',
      'You can clear cookies at any time via your browser settings; this will log you out.',
      'Our mobile applications may use local device storage for session state, preferences, and other app functionality.',
    ],
  },
  {
    iconColor: 'text-rose-600',
    iconBg: 'bg-rose-500/10',
    title: 'Data Retention',
    points: [
      'Active account data is retained as long as your account exists.',
      'After account deletion, personal data is purged within 30 days from live systems.',
      'Some data may be retained in encrypted backups for up to 90 days for legal compliance.',
      'Transaction records may be retained for as long as required by applicable financial, tax, anti-fraud, or other legal obligations.',
      'Content reported for safety violations may be retained longer for legal proceedings.',
    ],
  },
  {
    iconColor: 'text-teal-600',
    iconBg: 'bg-teal-500/10',
    title: 'Contact Us',
    points: [
      'Privacy enquiries: privacy@tsocial.com',
      'Data deletion requests: support@tsocial.com with subject "DATA DELETION REQUEST"',
      'General support: support@tsocial.com',
      'We will handle privacy requests within the time required by applicable law and may ask for information needed to verify the request.',
      'Testagram is operated by the entity identified in the applicable account, commercial, or legal records. Any registered-office or data-protection contact details required by law will be provided through the privacy contact process.',
    ],
  },
];

export default function PrivacyPolicyPage() {
  useSEO({
    title: 'Privacy Policy | Testagram',
    description: 'Learn how Testagram collects, uses, and protects your personal data. Read our full privacy policy.',
    url: '/privacy',
  });

  return (
    <div className="min-h-screen bg-background pb-20">
      <TopBar title="Privacy Policy" showBack />

      <div className="max-w-2xl mx-auto p-4 space-y-6">

        {/* Hero */}
        <div className="bg-gradient-to-br from-blue-500/10 via-background to-purple-500/5 border border-blue-500/20 rounded-2xl p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
            <Shield className="w-9 h-9 text-blue-600" />
          </div>
          <h1 className="text-2xl font-black mb-2">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            We believe privacy is a right, not a feature. Here's exactly what data we collect, why we collect it, and how we protect it.
          </p>
          <p className="text-[11px] text-muted-foreground mt-3 opacity-70">Last updated: September 2026 · Effective immediately</p>
        </div>

        {/* TL;DR */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-black text-base mb-3 flex items-center gap-2">
            <span className="text-lg">📋</span> TL;DR — The Short Version
          </h2>
          <div className="space-y-2 text-sm text-muted-foreground leading-relaxed">
            <p>✅ We only collect what we need to run the platform.</p>
            <p>✅ We never sell your data to advertisers or third parties.</p>
            <p>✅ You can request account deletion and exercise applicable data-subject rights.</p>
            <p>✅ Private communications are access-controlled. Where end-to-end encryption is enabled for a communication feature, the platform is designed not to have the keys needed to read that encrypted content.</p>
            <p>✅ Payment data is handled by PCI-compliant processors.</p>
          </div>
        </div>

        {/* Policy sections */}
        {POLICY_SECTIONS.map((section) => (
            <div key={section.title} className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/20">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${section.iconBg}`}>
                  {getPolicyIconNode(section.title, section.iconColor)}
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
            This policy may be updated periodically. We will notify you of significant changes via the platform inbox.
          </p>
          <p className="text-[10px] text-muted-foreground mt-2 opacity-60">© 2026 T Social Ltd. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
