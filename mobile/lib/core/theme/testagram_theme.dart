import 'package:flutter/material.dart';

/// Tokens mirror the live Testagram CSS variables in src/index.css.
/// Keep these values shared across Flutter Web and native Android.
class TestagramTheme {
  const TestagramTheme._();

  static const green = Color(0xFF148F44); // hsl(142 76% 32%)
  static const greenDark = Color(0xFF179F4B); // hsl(142 76% 36%)
  static const lightBackground = Color(0xFFFFFFFF);
  static const lightSurface = Color(0xFFFFFFFF);
  static const lightRaised = Color(0xFFFCFCFC);
  static const lightBorder = Color(0xFFE0E0E0);
  static const darkBackground = Color(0xFF000000);
  static const darkSurface = Color(0xFF121212);
  static const darkRaised = Color(0xFF242424);
  static const darkBorder = Color(0xFF262626);

  static ThemeData light() => _build(Brightness.light);
  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;
    final scheme = ColorScheme.fromSeed(
      seedColor: green,
      brightness: brightness,
      surface: isDark ? darkSurface : lightSurface,
      primary: isDark ? greenDark : green,
      secondary: isDark ? greenDark : green,
      outline: isDark ? darkBorder : lightBorder,
    );
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: isDark ? darkBackground : lightBackground,
      appBarTheme: AppBarTheme(
        backgroundColor: (isDark ? darkBackground : lightBackground).withValues(
          alpha: 0.78,
        ),
        foregroundColor: isDark ? Colors.white : const Color(0xFF0D0D0D),
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
      ),
      cardTheme: CardThemeData(
        color: isDark ? darkSurface : lightSurface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(18),
          side: BorderSide(
            color: (isDark ? darkBorder : lightBorder).withValues(alpha: 0.78),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? darkRaised : const Color(0xFFF2F2F2),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: BorderSide(
            color: (isDark ? darkBorder : lightBorder).withValues(alpha: 0.8),
          ),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(13),
          borderSide: const BorderSide(color: green, width: 1.5),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: isDark ? darkSurface : lightSurface,
        indicatorColor: (isDark ? greenDark : green).withValues(alpha: 0.13),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 11,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w700
                : FontWeight.w500,
          ),
        ),
      ),
      dividerColor: isDark ? darkBorder : lightBorder,
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }
}
