import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/fediverse/fediverse_content.dart';

void main() {
  group('normalizeFederatedContent', () {
    test('preserves article destinations when converting remote HTML', () {
      expect(
        normalizeFederatedContent(
          '<p>Read <a href="https://www.engadget.com/story">the article</a>.</p>',
        ),
        'Read the article (https://www.engadget.com/story).',
      );
    });

    test('keeps line breaks and decodes common entities', () {
      expect(
        normalizeFederatedContent('First &amp; foremost<br>Second&nbsp;line'),
        'First & foremost\nSecond line',
      );
    });

    test('strips markup instead of rendering untrusted remote HTML', () {
      expect(
        normalizeFederatedContent('<p>Hello <strong>Fediverse</strong></p>'),
        'Hello Fediverse',
      );
    });

    test('does not discard a URL when an anchor has no visible label', () {
      expect(
        normalizeFederatedContent('<a href="https://example.org/story"></a>'),
        'https://example.org/story',
      );
    });
  });
}
