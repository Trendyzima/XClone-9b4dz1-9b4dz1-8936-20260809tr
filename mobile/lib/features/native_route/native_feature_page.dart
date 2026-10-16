import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Native Flutter route target for route families whose dedicated workflows
/// are being ported in subsequent batches. This deliberately does not open the
/// legacy web app or pretend that a backend action has succeeded.
class NativeFeaturePage extends StatelessWidget {
  const NativeFeaturePage({
    required this.title,
    required this.routePath,
    this.pathParameters = const <String, String>{},
    super.key,
  });

  final String title;
  final String routePath;
  final Map<String, String> pathParameters;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final parameters = pathParameters.entries.toList();
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        leading: IconButton(
          tooltip: 'Back',
          icon: const Icon(Icons.arrow_back),
          onPressed: () {
            if (context.canPop()) {
              context.pop();
            } else {
              context.go('/');
            }
          },
        ),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(
            padding: const EdgeInsets.all(24),
            shrinkWrap: true,
            children: [
              Icon(Icons.widgets_outlined, size: 42, color: theme.colorScheme.primary),
              const SizedBox(height: 16),
              Text(title, style: theme.textTheme.headlineMedium, textAlign: TextAlign.center),
              const SizedBox(height: 8),
              Text(routePath, style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
              const SizedBox(height: 20),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Native Flutter route', style: theme.textTheme.titleMedium),
                      const SizedBox(height: 8),
                      const Text(
                        'This URL now resolves inside the Flutter application. '
                        'The dedicated feature workflow and its backend contract must still pass '
                        'their own implementation and test gates before this area is considered complete.',
                      ),
                      if (parameters.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        Text('Route parameters', style: theme.textTheme.titleSmall),
                        const SizedBox(height: 8),
                        for (final entry in parameters)
                          ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            title: Text(entry.key),
                            subtitle: SelectableText(entry.value),
                          ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 12,
                runSpacing: 12,
                children: [
                  OutlinedButton.icon(
                    onPressed: () => context.go('/explore'),
                    icon: const Icon(Icons.explore_outlined),
                    label: const Text('Explore'),
                  ),
                  FilledButton.icon(
                    onPressed: () => context.go('/'),
                    icon: const Icon(Icons.home_outlined),
                    label: const Text('Home feed'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
