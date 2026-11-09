/// Build-time configuration for the Testagram Flutter clients.
///
/// Appwrite is the identity provider and the Testagram Backend is the
/// application API. Never put privileged credentials in this file or in
/// `--dart-define` values. The legacy Supabase fields remain temporarily
/// available only while the remaining Flutter screens are migrated; they
/// must not be used by new code and are not part of the target architecture.
class AppConfig {
  const AppConfig._();

  static const appwriteEndpoint =
      String.fromEnvironment('APPWRITE_ENDPOINT');
  static const appwriteProjectId =
      String.fromEnvironment('APPWRITE_PROJECT_ID');
  static const testagramApiUrl =
      String.fromEnvironment('TESTAGRAM_API_URL');
  static const siteUrl = String.fromEnvironment(
    'TESTAGRAM_SITE_URL',
    defaultValue: 'https://testagram.site',
  );

  // Temporary migration compatibility. Remove after every Flutter feature
  // has moved to Appwrite sessions and the authenticated Backend API.
  @Deprecated('Use Appwrite authentication and TESTAGRAM_API_URL.')
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  @Deprecated('Use Appwrite authentication and TESTAGRAM_API_URL.')
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

  /// Kept as a compatibility gate until legacy screens are migrated.
  @Deprecated('Use isAppwriteConfigured and isTestagramApiConfigured.')
  static bool get isConfigured =>
      isAppwriteConfigured && isTestagramApiConfigured;

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
