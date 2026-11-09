/// Runtime configuration is injected at build time; secrets never belong in
/// Flutter assets. Supabase publishable keys are public identifiers, while all
/// access control remains enforced by Postgres RLS and server-side functions.
class AppConfig {
  const AppConfig._();

  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabasePublishableKey = String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY');
  static const appwriteEndpoint = String.fromEnvironment('APPWRITE_ENDPOINT');
  static const appwriteProjectId = String.fromEnvironment('APPWRITE_PROJECT_ID');
  static const testagramApiUrl = String.fromEnvironment('TESTAGRAM_API_URL');
  static const siteUrl = String.fromEnvironment(
    'TESTAGRAM_SITE_URL',
    defaultValue: 'https://testagram.site',
  );

  static bool get isConfigured =>
      _validUrl(supabaseUrl) && supabasePublishableKey.trim().isNotEmpty;

  static bool get isAppwriteConfigured =>
      _validUrl(appwriteEndpoint) && appwriteProjectId.trim().isNotEmpty;

  static bool get isTestagramApiConfigured => _validUrl(testagramApiUrl);

  static bool _validUrl(String value) {
    final uri = Uri.tryParse(value);
    return uri != null && (uri.scheme == 'https' || uri.scheme == 'http') && uri.host.isNotEmpty;
  }
}
