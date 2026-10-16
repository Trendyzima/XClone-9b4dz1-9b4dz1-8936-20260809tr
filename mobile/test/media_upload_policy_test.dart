import 'package:flutter_test/flutter_test.dart';
import 'package:testagram/core/media/media_upload_policy.dart';

void main() {
  group('MediaUploadPolicy', () {
    test('accepts supported image and video extensions case-insensitively', () {
      expect(
        MediaUploadPolicy.normalizeExtension('photo.JPEG', isVideo: false),
        'jpeg',
      );
      expect(
        MediaUploadPolicy.normalizeExtension('clip.MP4', isVideo: true),
        'mp4',
      );
      expect(
        MediaUploadPolicy.normalizeExtension('clip.webm', isVideo: true),
        'webm',
      );
    });

    test('rejects unsupported or missing extensions', () {
      expect(
        () =>
            MediaUploadPolicy.normalizeExtension('payload.exe', isVideo: false),
        throwsFormatException,
      );
      expect(
        () =>
            MediaUploadPolicy.normalizeExtension('no-extension', isVideo: true),
        throwsFormatException,
      );
    });

    test('enforces positive size and separate image/video limits', () {
      expect(
        () => MediaUploadPolicy.validateSize(0, isVideo: false),
        throwsFormatException,
      );
      expect(
        () => MediaUploadPolicy.validateSize(
          MediaUploadPolicy.imageMaxBytes + 1,
          isVideo: false,
        ),
        throwsFormatException,
      );
      expect(
        () => MediaUploadPolicy.validateSize(
          MediaUploadPolicy.videoMaxBytes + 1,
          isVideo: true,
        ),
        throwsFormatException,
      );
      expect(
        () => MediaUploadPolicy.validateSize(
          MediaUploadPolicy.imageMaxBytes,
          isVideo: false,
        ),
        returnsNormally,
      );
    });

    test('maps content types explicitly', () {
      expect(MediaUploadPolicy.contentType('jpg'), 'image/jpeg');
      expect(MediaUploadPolicy.contentType('mov'), 'video/quicktime');
      expect(() => MediaUploadPolicy.contentType('exe'), throwsFormatException);
    });
  });
}
