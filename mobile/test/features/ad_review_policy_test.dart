import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/ads/ad_review_policy.dart';

void main() {
  test('review decisions require authorization, no active request, and pending status', () {
    expect(
      AdReviewPolicy.canReview(
        authorized: true,
        busy: false,
        status: 'pending',
      ),
      isTrue,
    );
    expect(
      AdReviewPolicy.canReview(
        authorized: false,
        busy: false,
        status: 'pending',
      ),
      isFalse,
    );
    expect(
      AdReviewPolicy.canReview(authorized: true, busy: true, status: 'pending'),
      isFalse,
    );
    expect(
      AdReviewPolicy.canReview(
        authorized: true,
        busy: false,
        status: 'approved',
      ),
      isFalse,
    );
  });

  test('rejection requires a bounded non-empty reason', () {
    expect(AdReviewPolicy.canReject('policy violation'), isTrue);
    expect(AdReviewPolicy.canReject('  '), isFalse);
    expect(AdReviewPolicy.canReject('x' * 501), isFalse);
  });

  test('budget micros are converted to currency units', () {
    expect(AdReviewPolicy.formatBudget(1500000, 'KES'), 'KES 1.50');
    expect(AdReviewPolicy.formatBudget(null, 'KES'), 'KES 0.00');
  });
}
