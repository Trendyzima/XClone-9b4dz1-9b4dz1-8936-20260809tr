import 'dart:js_interop';
import 'dart:js_interop_unsafe';

@JS('testagramWarmIptvStream')
external JSFunction? get _warmIptvStream;

/// Best-effort, bounded HLS manifest/segment warm-up in the browser.
void warmIptvStream(String url) {
  try {
    _warmIptvStream?.callAsFunction<JSAny?>(null, url.toJS);
  } catch (_) {
    // Prefetch is optional and must never block normal playback.
  }
}
