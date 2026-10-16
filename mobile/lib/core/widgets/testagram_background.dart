import 'package:flutter/material.dart';

import '../theme/testagram_theme.dart';

/// Native/Web Flutter translation of Testagram's tactile CSS background:
/// black/white base, a green top bloom, a faint secondary glow, fine grain,
/// and a barely-visible diagonal sheen. All decoration is non-interactive.
class TestagramBackground extends StatelessWidget {
  const TestagramBackground({required this.child, super.key});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        gradient: RadialGradient(
          center: const Alignment(0, -1.7),
          radius: 1.65,
          colors: [
            TestagramTheme.green.withValues(alpha: dark ? 0.11 : 0.07),
            Colors.transparent,
          ],
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned.fill(
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: RadialGradient(
                    center: const Alignment(1, -0.75),
                    radius: 1.2,
                    colors: [
                      const Color(0xFF9867E8)
                          .withValues(alpha: dark ? 0.018 : 0.035),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: CustomPaint(painter: _TexturePainter(dark: dark)),
            ),
          ),
          child,
        ],
      ),
    );
  }
}

class _TexturePainter extends CustomPainter {
  const _TexturePainter({required this.dark});
  final bool dark;

  @override
  void paint(Canvas canvas, Size size) {
    final primary = Paint()
      ..color = TestagramTheme.green.withValues(alpha: dark ? 0.018 : 0.019);
    final secondary = Paint()
      ..color = (dark ? Colors.white : Colors.black).withValues(
        alpha: dark ? 0.012 : 0.009,
      );
    for (double y = 12; y < size.height; y += 19) {
      for (double x = 10; x < size.width; x += 19) {
        canvas.drawCircle(Offset(x, y), 0.58, primary);
      }
    }
    for (double y = 18; y < size.height; y += 23) {
      for (double x = 16; x < size.width; x += 23) {
        canvas.drawCircle(Offset(x, y), 0.42, secondary);
      }
    }
    final sheen = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Colors.transparent,
          TestagramTheme.green.withValues(alpha: dark ? 0.008 : 0.012),
          Colors.transparent,
        ],
        stops: const [0.43, 0.5, 0.57],
      ).createShader(Offset.zero & size);
    canvas.drawRect(Offset.zero & size, sheen);
  }

  @override
  bool shouldRepaint(covariant _TexturePainter oldDelegate) =>
      oldDelegate.dark != dark;
}
