import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

class LegalSection {
  const LegalSection(this.title, this.points);
  final String title;
  final List<String> points;
}

class HelpPage extends StatefulWidget {
  const HelpPage({super.key});
  @override
  State<HelpPage> createState() => _HelpPageState();
}

class _HelpPageState extends State<HelpPage> {
  final _search = TextEditingController();
  static const _faqs = <LegalSection>[
    LegalSection('Account and profile', [
      'To update your profile, open Profile, choose Edit Profile, change the fields you need, and save.',
      'Usernames must be unique. If a username is unavailable, choose another one.',
      'Use Settings → Privacy & Security to manage account visibility and discovery preferences.',
      'If you suspect account compromise, sign out other sessions where available and change your password.',
    ]),
    LegalSection('Posts and community', [
      'Create posts from the compose control. Add supported media, a caption, mentions, or hashtags before publishing.',
      'Use the post menu or profile menu to report content or an account that may violate the Community Policy.',
      'Lists organize accounts. The list owner controls membership, while server-side privacy rules determine who can view private lists.',
      'Polls require a question and at least two options. Voting is subject to the poll status and server-side vote rules.',
    ]),
    LegalSection('Wallet and payments', [
      'Review the amount, fees, destination, and confirmation details before submitting a wallet transaction.',
      'For a missing or failed payment, contact support with the provider transaction reference; never send your password or PIN.',
      'M-Pesa availability, payout eligibility, limits, and processing times are shown in the relevant transaction flow and may change.',
    ]),
    LegalSection('Safety and privacy', [
      'Block an account to restrict interaction, or mute it to reduce its content in your experience.',
      'Read the Privacy Policy to understand information use, retention, and available privacy choices.',
      'Appeal an enforcement action through the Appeals feature and include the relevant case details.',
    ]),
  ];

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _contactSupport() async {
    final uri = Uri(
      scheme: 'mailto',
      path: 'testagramreels@gmail.com',
      queryParameters: {'subject': 'Testagram support request'},
    );
    try {
      final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!opened && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not open an email app. Contact testagramreels@gmail.com.'),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not open an email app. Contact testagramreels@gmail.com.'),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final q = _search.text.trim().toLowerCase();
    final visible = _faqs
        .map(
          (section) => LegalSection(
            section.title,
            section.points
                .where(
                  (point) =>
                      q.isEmpty ||
                      section.title.toLowerCase().contains(q) ||
                      point.toLowerCase().contains(q),
                )
                .toList(),
          ),
        )
        .where((section) => section.points.isNotEmpty)
        .toList();
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Help centre',
          style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 6),
        const Text('Find practical answers about your account, posts, payments, and safety.'),
        const SizedBox(height: 14),
        TextField(
          controller: _search,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(
            prefixIcon: Icon(Icons.search),
            hintText: 'Search help articles',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 12),
        for (final section in visible)
          Card(
            child: ExpansionTile(
              title: Text(section.title, style: const TextStyle(fontWeight: FontWeight.w800)),
              children: [
                for (final point in section.points)
                  ListTile(leading: const Icon(Icons.help_outline), title: Text(point)),
              ],
            ),
          ),
        if (visible.isEmpty)
          const Padding(
            padding: EdgeInsets.all(24),
            child: Text('No help articles match that search. Try another keyword.'),
          ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            leading: const Icon(Icons.mail_outline),
            title: const Text('Contact support'),
            subtitle: const Text('Email the Testagram support team.'),
            trailing: const Icon(Icons.open_in_new),
            onTap: _contactSupport,
          ),
        ),
      ],
    );
  }
}

class ContentPolicyPage extends StatelessWidget {
  const ContentPolicyPage({super.key});
  static const sections = <LegalSection>[
    LegalSection('Age eligibility', [
      'Testagram is intended for adults aged 18 and above. Do not create or use an account if you are under 18.',
    ]),
    LegalSection('Hate speech and harassment', [
      'Do not threaten, dehumanize, or target people with hateful abuse.',
      'Do not threaten violence, coordinate harassment, dox people, or repeatedly contact someone to intimidate them.',
    ]),
    LegalSection('Sexual content and violence', [
      'Pornographic, exploitative, non-consensual intimate, or sexual content involving minors is prohibited.',
      'Do not glorify real-world violence, publish graphic material without legitimate context, or promote self-harm.',
    ]),
    LegalSection('Spam, fraud, and misinformation', [
      'Do not run phishing, financial scams, fake engagement, impersonation, or mass spam.',
      'Do not publish dangerous false claims about health, elections, emergencies, or other matters that can cause significant real-world harm.',
    ]),
    LegalSection('Advertising', [
      'Paid placements must be clearly represented as advertising.',
      'Ads must use honest claims and working destinations. Illegal products, counterfeit goods, sexual imagery, tobacco, and deceptive claims are prohibited.',
    ]),
    LegalSection('Reporting, enforcement, and appeals', [
      'Report a post, profile, message, or advertisement through the relevant in-app controls.',
      'Reports may trigger review; a report alone is not a finding of a violation. Actions can include a warning, content removal, feature restriction, or account suspension.',
      'Use the Appeals feature if you believe an enforcement decision was incorrect. Review times vary.',
    ]),
  ];
  @override
  Widget build(BuildContext context) => const LegalDocumentPage(
        title: 'Content policy',
        intro:
            'These community standards describe prohibited behavior and how safety reports and enforcement are handled.',
        sections: sections,
        updated: 'October 2026',
      );
}

class PrivacyPolicyPage extends StatelessWidget {
  const PrivacyPolicyPage({super.key});
  static const sections = <LegalSection>[
    LegalSection('Information we collect', [
      'Account and profile details you provide; posts, replies, messages, polls, and media you upload; interactions and usage data; technical and security metadata; and transaction references needed to reconcile payments.',
    ]),
    LegalSection('How information is used', [
      'To operate and secure the platform, personalise features, process transactions, send relevant notifications, prevent fraud, enforce policies, respond to support requests, and improve reliability.',
    ]),
    LegalSection('Sharing', [
      'We do not sell personal data to third parties for their independent advertising or data-broker use.',
      'Public profiles and public content may be visible to other users and, where applicable, search engines. Service providers may process information as needed to operate the service. Information may also be disclosed where required by law or to address safety and security.',
    ]),
    LegalSection('Security and retention', [
      'We use access controls and database row-level security for private data. No online service can guarantee absolute security.',
      'Active account data is retained while an account exists. Deletion requests are processed subject to applicable law, transaction records, safety needs, and backup retention requirements.',
    ]),
    LegalSection('Your choices and rights', [
      'You can update available profile information and manage privacy, discovery, and personalisation settings in the app.',
      'You may contact support to request access, correction, deletion, or other applicable data-subject rights. Some records may need to be retained for legal or financial obligations.',
    ]),
    LegalSection('Contact', [
      'For privacy questions or requests, contact testagramreels@gmail.com and include enough detail to identify the request without sending passwords or authentication codes.',
    ]),
  ];
  @override
  Widget build(BuildContext context) => const LegalDocumentPage(
        title: 'Privacy policy',
        intro:
            'This policy explains the categories of information Testagram handles, why it is used, and choices available to you.',
        sections: sections,
        updated: 'October 2026',
      );
}

class TermsOfServicePage extends StatelessWidget {
  const TermsOfServicePage({super.key});
  static const sections = <LegalSection>[
    LegalSection('1. Eligibility and accounts', [
      'You must be at least 18 years old to use Testagram.',
      'Keep your credentials secure and provide accurate account information. Impersonation, evading enforcement, and abuse of promotions or security controls are prohibited.',
    ]),
    LegalSection('2. Content and intellectual property', [
      'You retain ownership of content you create. You grant Testagram the limited licence needed to host, process, display, secure, moderate, and distribute that content as part of operating the service.',
      'Only upload content you have the rights to share. Do not infringe other people’s intellectual property or scrape the platform without written permission.',
    ]),
    LegalSection('3. Payments and creator earnings', [
      'Wallet, payment, and creator features are subject to the eligibility, verification, fee, limit, and payout terms displayed in the relevant flow.',
      'Review transaction details before confirming. Earnings can be withheld where reasonably necessary to investigate fraud or policy violations.',
    ]),
    LegalSection('4. Prohibited conduct', [
      'Do not use Testagram for harassment, threats, fraud, phishing, illegal activity, unauthorised access, fake engagement, or content that violates the Community Policy.',
    ]),
    LegalSection('5. Enforcement and termination', [
      'Policy violations can lead to warnings, content removal, feature restrictions, temporary suspension, or termination, depending on severity and context.',
      'Where available, use the in-app Appeals feature to challenge an enforcement action.',
    ]),
    LegalSection('6. Availability and liability', [
      'The service is provided as available; uninterrupted access and error-free operation are not guaranteed.',
      'Nothing in these terms excludes rights or remedies that cannot lawfully be excluded under applicable law.',
    ]),
    LegalSection('7. Governing law and changes', [
      'These terms are governed by the laws of the Republic of Kenya, subject to any mandatory rights that apply to you.',
      'Terms may change as the service evolves. Material changes will be communicated where required by law.',
    ]),
  ];
  @override
  Widget build(BuildContext context) => const LegalDocumentPage(
        title: 'Terms of service',
        intro:
            'These terms govern access to Testagram and use of its social, creator, media, and commerce features.',
        sections: sections,
        updated: 'October 2026',
      );
}

class LegalDocumentPage extends StatelessWidget {
  const LegalDocumentPage({
    required this.title,
    required this.intro,
    required this.sections,
    required this.updated,
    super.key,
  });
  final String title;
  final String intro;
  final List<LegalSection> sections;
  final String updated;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(title, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        Text(intro),
        const SizedBox(height: 6),
        Text('Last reviewed: $updated', style: theme.textTheme.bodySmall),
        const SizedBox(height: 12),
        for (final section in sections)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    section.title,
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 8),
                  for (final point in section.points)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 7, right: 8),
                            child: Icon(Icons.circle, size: 5),
                          ),
                          Expanded(child: Text(point)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
