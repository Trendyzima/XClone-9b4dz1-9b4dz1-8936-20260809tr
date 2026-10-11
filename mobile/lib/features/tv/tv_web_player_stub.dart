import 'package:flutter/material.dart';

class TvWebPlayer extends StatelessWidget {
  const TvWebPlayer({required this.url, this.onError, super.key});

  final String url;
  final ValueChanged<String>? onError;

  @override
  Widget build(BuildContext context) => const ColoredBox(
        color: Colors.black,
        child: Center(
          child: Text(
            'Browser stream playback is not available on this platform.',
            style: TextStyle(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
        ),
      );
}
