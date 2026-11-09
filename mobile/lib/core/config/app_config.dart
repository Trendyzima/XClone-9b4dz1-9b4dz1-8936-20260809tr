/// Build-time configuration for the Testagram Flutter clients.
///
/// Appwrite is the target identity provider and the Testagram Backend is the
/// target application API. Never put privileged credentials in this file or
/// in `--dart-define` values. Legacy Supabase fields below are temporary
/// compatibility only; new code must not depend on them.
class AppConfig {
  const AppConfig._();

  static const appwriteEndpoint =
      String.fromEnvironment('VITE_APPWRITE_ENDPOINT');
  static const appwriteProjectId =
      String.fromEnvironment('VITE_APPWRITE_PROJECT_ID');
  static const testagramApiUrl =
      String.fromEnvironment('VITE_TESTAGRAM_API_URL');
  static const siteUrl = String.fromEnvironment(
    'TESTAGRAM_SITE_URL',
    defaultValue: 'https://testagram.site',
  );

  // Temporary migration compatibility for screens not yet moved to Appwrite.
  @Deprecated('Migrate this caller to Appwrite authentication.')
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  @Deprecated('Migrate this caller to Appwrite authentication.')
  static const supabasePublishableKey =
      String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY');

  static bool get isAppwriteConfigured {
    final endpoint = Uri.tryParse(appwriteEndpoint.trim());
    final projectId = appwriteProjectId.trim();
    return _isHttpUrl(appwriteEndpoint) &&
        endpoint != null &&
        endpoint.path.replaceFirst(RegExp(r'/+$'), '').endsWith('/v1') &&
        RegExp(r'^[A-Za-z0-9_-]{1,128}$').hasMatch(projectId);
  }

  static bool get isTestagramApiConfigured =>
      _isSecureServiceUrl(testagramApiUrl);

  /// Transitional gate for the legacy application bootstrap. This remains
  /// Supabase-based until main.dart and every dependent screen are migrated.
  @Deprecated('Use Appwrite session bootstrap after the auth migration.')
  static bool get isConfigured =>
      _isHttpUrl(supabaseUrl) && supabasePublishableKey.trim().isNotEmpty;

  static bool _isHttpUrl(String value) {
    final uri = Uri.tryParse(value.trim());
    return uri != null &&
        (uri.scheme == 'https' || uri.scheme == 'http') &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty;
  }

  static bool _isSecureServiceUrl(String value) {
    final uri = Uri.tryParse(value.trim());
    if (uri == null ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      return false;
    }
    final localHttp = uri.scheme == 'http' &&
        const {'localhost', '127.0.0.1', '[::1]'}.contains(uri.host);
    return uri.scheme == 'https' || localHttp;
  }
}
