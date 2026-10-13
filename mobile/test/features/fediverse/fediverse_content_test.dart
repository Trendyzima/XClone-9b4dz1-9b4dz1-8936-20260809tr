import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/features/fediverse/fediverse_content.dart';

void main() {
  group('normalizeFederatedContent', () {
    test('converts paragraphs and line breaks into readable text', () {
      expect(normalizeFederatedContent('<p>Hello<br>world</p><p>Again</p>'),
          'Hello\nworld\nAgain');
    });

    test('decodes common entities after removing markup', () {
      expect(normalizeFederatedContent('<b>A &amp; B</b> &lt;ok&gt;&nbsp;'),
          'A & B <ok>');
    });

    test('does not retain script or markup tags in display text', () {
      expect(normalizeFederatedContent('<script>alert(1)</script><i>safe</i>'),
          'alert(1)safe');
    });
  });
}
