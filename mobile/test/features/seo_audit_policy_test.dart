import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/admin/seo_audit_policy.dart';

void main() {
  test(
      'SEO manifest has broad route coverage and includes private noindex routes',
      () {
    expect(seoRouteContracts.length, greaterThanOrEqualTo(60));
    expect(seoRouteContracts.any((route) => route.path == '/'), isTrue);
    expect(
        seoRouteContracts
            .any((route) => route.path == '/admin/seo' && route.noindex),
        isTrue);
    expect(
        seoRouteContracts.where((route) => route.noindex).isNotEmpty, isTrue);
  });

  test('SEO scoring never treats noindex routes as indexable good pages', () {
    const privateRoute = SeoRouteContract(
        path: '/wallet',
        label: 'Wallet',
        group: 'Private',
        hasUseSeo: true,
        hasStructuredData: false,
        noindex: true);
    const publicRoute = SeoRouteContract(
        path: '/explore',
        label: 'Explore',
        group: 'Core',
        hasUseSeo: true,
        hasStructuredData: true,
        noindex: false);
    const incompleteRoute = SeoRouteContract(
        path: '/profile/{username}',
        label: 'Profile',
        group: 'Dynamic',
        hasUseSeo: false,
        hasStructuredData: false,
        noindex: false);
    expect(privateRoute.status, SeoRouteStatus.noindex);
    expect(publicRoute.status, SeoRouteStatus.good);
    expect(incompleteRoute.status, SeoRouteStatus.missing);
  });
}
