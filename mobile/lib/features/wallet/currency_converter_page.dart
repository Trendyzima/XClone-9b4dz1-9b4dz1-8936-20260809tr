import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

/// Pure conversion arithmetic, separated for deterministic unit testing.
class CurrencyConversion {
  static double? convert({
    required double amount,
    required double? fromRate,
    required double? toRate,
  }) {
    if (!amount.isFinite ||
        amount < 0 ||
        fromRate == null ||
        toRate == null ||
        !fromRate.isFinite ||
        !toRate.isFinite ||
        fromRate <= 0 ||
        toRate <= 0) {
      return null;
    }
    return amount / fromRate * toRate;
  }
}

/// Currency conversion is informational only; it never initiates a wallet
/// transfer.
class CurrencyConverterPage extends StatefulWidget {
  const CurrencyConverterPage({super.key});

  @override
  State<CurrencyConverterPage> createState() => _CurrencyConverterPageState();
}

class _CurrencyConverterPageState extends State<CurrencyConverterPage> {
  static const _currencies = <String, String>{
    'KES': 'Kenyan shilling',
    'USD': 'US dollar',
    'EUR': 'Euro',
    'GBP': 'British pound',
    'UGX': 'Ugandan shilling',
    'TZS': 'Tanzanian shilling',
    'NGN': 'Nigerian naira',
    'ZAR': 'South African rand',
    'INR': 'Indian rupee',
    'CAD': 'Canadian dollar',
    'AUD': 'Australian dollar',
    'JPY': 'Japanese yen',
    'CHF': 'Swiss franc',
  };

  final _amountController = TextEditingController(text: '1');
  String _from = 'KES';
  String _to = 'USD';
  Map<String, double> _rates = const {};
  DateTime? _updatedAt;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadRates();
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  double? get _amount {
    final parsed = double.tryParse(_amountController.text.trim());
    return parsed != null && parsed.isFinite && parsed >= 0 ? parsed : null;
  }

  double? get _converted {
    final amount = _amount;
    if (amount == null) return null;
    return CurrencyConversion.convert(amount: amount, fromRate: _rates[_from], toRate: _rates[_to]);
  }

  Future<void> _loadRates() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response = await http
          .get(Uri.https('open.er-api.com', '/v6/latest/USD'))
          .timeout(const Duration(seconds: 12));
      if (response.statusCode != 200) {
        throw const FormatException('Exchange-rate service unavailable');
      }
      final payload = jsonDecode(response.body);
      if (payload is! Map<String, dynamic> || payload['result'] != 'success') {
        throw const FormatException('Exchange-rate response was invalid');
      }
      final rawRates = payload['rates'];
      if (rawRates is! Map) {
        throw const FormatException('Exchange rates were missing');
      }
      final rates = <String, double>{};
      for (final entry in rawRates.entries) {
        final value = entry.value;
        if (value is num && value.isFinite && value > 0) {
          rates['${entry.key}'] = value.toDouble();
        }
      }
      if (!_currencies.keys.every(rates.containsKey)) {
        throw const FormatException('One or more selected currencies are unavailable');
      }
      final timestamp = payload['time_last_update_utc']?.toString();
      if (!mounted) return;
      setState(() {
        _rates = rates;
        _updatedAt = timestamp == null ? null : DateTime.tryParse(timestamp);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error =
            'Live exchange rates could not be loaded. Check your connection and retry; no rate has been guessed.';
      });
    }
  }

  void _swap() {
    setState(() {
      final previous = _from;
      _from = _to;
      _to = previous;
    });
  }

  String _format(double value) => value.toStringAsFixed(value.abs() >= 1000 ? 2 : 4);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final converted = _converted;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Currency converter'),
        actions: [
          IconButton(
            tooltip: 'Refresh exchange rates',
            onPressed: _loading ? null : _loadRates,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Convert currencies',
            style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          const Text(
            'Indicative conversion using published exchange rates. This is not a quote, fee calculation, or wallet transfer.',
          ),
          const SizedBox(height: 20),
          TextField(
            controller: _amountController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(labelText: 'Amount', border: OutlineInputBorder()),
          ),
          const SizedBox(height: 12),
          _currencyPicker(
            label: 'From',
            value: _from,
            onChanged: (value) => setState(() => _from = value),
          ),
          Align(
            alignment: Alignment.center,
            child: IconButton.filledTonal(
              tooltip: 'Swap currencies',
              onPressed: _swap,
              icon: const Icon(Icons.swap_vert_rounded),
            ),
          ),
          _currencyPicker(
            label: 'To',
            value: _to,
            onChanged: (value) => setState(() => _to = value),
          ),
          const SizedBox(height: 18),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Estimated amount', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 8),
                  if (_loading)
                    const LinearProgressIndicator()
                  else if (converted != null)
                    Text(
                      '$_to ${_format(converted)}',
                      style: theme.textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w900),
                    )
                  else
                    Text(
                      _amount == null
                          ? 'Enter a valid non-negative amount.'
                          : 'A conversion is not available.',
                      style: theme.textTheme.bodyLarge,
                    ),
                  if (_updatedAt != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Rates last updated: ${_updatedAt!.toUtc().toIso8601String().replaceFirst('T', ' ').substring(0, 19)} UTC',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ],
              ),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            MaterialBanner(
              content: Text(_error!),
              actions: [
                TextButton(onPressed: _loading ? null : _loadRates, child: const Text('Retry')),
              ],
            ),
          ],
          const SizedBox(height: 12),
          const Text(
            'Rates may be delayed and providers, banks, and payment services may apply different rates or fees. Verify the final amount before making any financial decision.',
          ),
        ],
      ),
    );
  }

  Widget _currencyPicker({
    required String label,
    required String value,
    required ValueChanged<String> onChanged,
  }) {
    return DropdownButtonFormField<String>(
      value: value,
      isExpanded: true,
      decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      items: [
        for (final entry in _currencies.entries)
          DropdownMenuItem(value: entry.key, child: Text('${entry.key} — ${entry.value}')),
      ],
      onChanged: (next) {
        if (next != null) onChanged(next);
      },
    );
  }
}
