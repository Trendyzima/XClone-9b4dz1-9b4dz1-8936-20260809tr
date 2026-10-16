/// Client-side guardrails for social post media uploads.
/// Server/storage policies remain the authoritative security boundary.
class MediaUploadPolicy {
  const MediaUploadPolicy._();

  static const imageMaxBytes = 20 * 1024 * 1024;
  static const videoMaxBytes = 100 * 1024 * 1024;
  static const imageExtensions = {'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'};
  static const videoExtensions = {'mp4', 'mov', 'm4v', 'webm'};

  static String normalizeExtension(String filename, {required bool isVideo}) {
    final hasExtension = filename.contains('.') && !filename.endsWith('.');
    final extension = hasExtension ? filename.split('.').last.toLowerCase() : '';
    final allowed = isVideo ? videoExtensions : imageExtensions;
    if (!allowed.contains(extension)) {
      throw const FormatException(
        'Unsupported media format. Choose JPG, PNG, WebP or MP4/MOV/M4V/WebM.',
      );
    }
    return extension;
  }

  static void validateSize(int bytes, {required bool isVideo}) {
    if (bytes <= 0) {
      throw const FormatException('The selected media file is empty.');
    }
    final limit = isVideo ? videoMaxBytes : imageMaxBytes;
    if (bytes > limit) {
      throw FormatException(
        isVideo ? 'Videos must be 100 MB or smaller.' : 'Images must be 20 MB or smaller.',
      );
    }
  }

  static String contentType(String extension) => switch (extension.toLowerCase()) {
        'jpg' || 'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp',
        'heic' => 'image/heic',
        'heif' => 'image/heif',
        'mov' => 'video/quicktime',
        'webm' => 'video/webm',
        'mp4' || 'm4v' => 'video/mp4',
        _ => throw const FormatException('Unsupported media format.'),
      };
}
