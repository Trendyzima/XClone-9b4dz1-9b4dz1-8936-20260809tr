import type { CSSProperties } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ThemePresetId = 'default' | 'ocean' | 'sunset' | 'lavender' | 'rose' | 'midnight' | 'amoled' | 'sand';

export type AppearanceSettings = {
  mode: ThemeChoice;
  preset: ThemePresetId;
  accent?: string;
  background?: string;
  radius?: 'compact' | 'rounded' | 'pill';
};

type ThemePalette = Record<string, string>;

export type ThemePreset = {
  id: ThemePresetId;
  name: string;
  description: string;
  light: ThemePalette;
  dark: ThemePalette;
};

const common = {
  '--destructive': '0 84% 60%',
  '--destructive-foreground': '0 0% 100%',
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'default', name: 'Testagram', description: 'Clean emerald',
    light: { '--background':'0 0% 100%','--foreground':'0 0% 5%','--card':'0 0% 100%','--card-foreground':'0 0% 5%','--popover':'0 0% 100%','--popover-foreground':'0 0% 5%','--primary':'142 76% 32%','--primary-foreground':'0 0% 100%','--secondary':'0 0% 95%','--secondary-foreground':'0 0% 9%','--muted':'0 0% 95%','--muted-foreground':'0 0% 42%','--accent':'142 76% 32%','--accent-foreground':'0 0% 100%','--border':'0 0% 88%','--input':'0 0% 88%','--ring':'142 76% 32%',...common },
    dark: { '--background':'0 0% 0%','--foreground':'0 0% 98%','--card':'0 0% 7%','--card-foreground':'0 0% 98%','--popover':'0 0% 7%','--popover-foreground':'0 0% 98%','--primary':'142 76% 36%','--primary-foreground':'0 0% 100%','--secondary':'0 0% 14%','--secondary-foreground':'0 0% 98%','--muted':'0 0% 14%','--muted-foreground':'0 0% 65%','--accent':'142 76% 36%','--accent-foreground':'0 0% 100%','--border':'0 0% 15%','--input':'0 0% 15%','--ring':'142 76% 36%',...common },
  },
  {
    id: 'ocean', name: 'Ocean', description: 'Cool blue',
    light: { '--background':'210 40% 98%','--foreground':'215 30% 12%','--card':'0 0% 100%','--card-foreground':'215 30% 12%','--popover':'0 0% 100%','--popover-foreground':'215 30% 12%','--primary':'199 89% 42%','--primary-foreground':'0 0% 100%','--secondary':'204 32% 93%','--secondary-foreground':'215 30% 15%','--muted':'204 32% 93%','--muted-foreground':'215 16% 42%','--accent':'199 89% 42%','--accent-foreground':'0 0% 100%','--border':'204 24% 86%','--input':'204 24% 86%','--ring':'199 89% 42%',...common },
    dark: { '--background':'222 47% 7%','--foreground':'210 40% 98%','--card':'222 38% 11%','--card-foreground':'210 40% 98%','--popover':'222 38% 11%','--popover-foreground':'210 40% 98%','--primary':'199 89% 55%','--primary-foreground':'222 47% 7%','--secondary':'217 33% 17%','--secondary-foreground':'210 40% 98%','--muted':'217 33% 17%','--muted-foreground':'215 20% 70%','--accent':'199 89% 55%','--accent-foreground':'222 47% 7%','--border':'217 28% 22%','--input':'217 28% 22%','--ring':'199 89% 55%',...common },
  },
  {
    id: 'sunset', name: 'Sunset', description: 'Warm coral',
    light: { '--background':'20 60% 98%','--foreground':'20 25% 12%','--card':'0 0% 100%','--card-foreground':'20 25% 12%','--popover':'0 0% 100%','--popover-foreground':'20 25% 12%','--primary':'15 84% 52%','--primary-foreground':'0 0% 100%','--secondary':'28 55% 93%','--secondary-foreground':'20 25% 15%','--muted':'28 55% 93%','--muted-foreground':'20 15% 44%','--accent':'15 84% 52%','--accent-foreground':'0 0% 100%','--border':'25 35% 87%','--input':'25 35% 87%','--ring':'15 84% 52%',...common },
    dark: { '--background':'18 25% 7%','--foreground':'30 35% 98%','--card':'18 22% 11%','--card-foreground':'30 35% 98%','--popover':'18 22% 11%','--popover-foreground':'30 35% 98%','--primary':'15 90% 60%','--primary-foreground':'18 25% 7%','--secondary':'20 22% 18%','--secondary-foreground':'30 35% 98%','--muted':'20 22% 18%','--muted-foreground':'25 18% 72%','--accent':'15 90% 60%','--accent-foreground':'18 25% 7%','--border':'20 18% 23%','--input':'20 18% 23%','--ring':'15 90% 60%',...common },
  },
  {
    id: 'lavender', name: 'Lavender', description: 'Soft violet',
    light: { '--background':'260 30% 98%','--foreground':'260 22% 14%','--card':'0 0% 100%','--card-foreground':'260 22% 14%','--popover':'0 0% 100%','--popover-foreground':'260 22% 14%','--primary':'262 83% 58%','--primary-foreground':'0 0% 100%','--secondary':'258 32% 94%','--secondary-foreground':'260 22% 16%','--muted':'258 32% 94%','--muted-foreground':'260 12% 45%','--accent':'262 83% 58%','--accent-foreground':'0 0% 100%','--border':'258 25% 88%','--input':'258 25% 88%','--ring':'262 83% 58%',...common },
    dark: { '--background':'260 28% 7%','--foreground':'260 30% 98%','--card':'260 23% 11%','--card-foreground':'260 30% 98%','--popover':'260 23% 11%','--popover-foreground':'260 30% 98%','--primary':'262 83% 68%','--primary-foreground':'260 28% 7%','--secondary':'260 20% 18%','--secondary-foreground':'260 30% 98%','--muted':'260 20% 18%','--muted-foreground':'260 12% 72%','--accent':'262 83% 68%','--accent-foreground':'260 28% 7%','--border':'260 17% 23%','--input':'260 17% 23%','--ring':'262 83% 68%',...common },
  },
  {
    id: 'rose', name: 'Rose', description: 'Modern pink',
    light: { '--background':'0 30% 99%','--foreground':'340 25% 12%','--card':'0 0% 100%','--card-foreground':'340 25% 12%','--popover':'0 0% 100%','--popover-foreground':'340 25% 12%','--primary':'340 82% 52%','--primary-foreground':'0 0% 100%','--secondary':'340 35% 94%','--secondary-foreground':'340 25% 16%','--muted':'340 35% 94%','--muted-foreground':'340 12% 44%','--accent':'340 82% 52%','--accent-foreground':'0 0% 100%','--border':'340 22% 88%','--input':'340 22% 88%','--ring':'340 82% 52%',...common },
    dark: { '--background':'340 24% 7%','--foreground':'340 30% 98%','--card':'340 20% 11%','--card-foreground':'340 30% 98%','--popover':'340 20% 11%','--popover-foreground':'340 30% 98%','--primary':'340 82% 64%','--primary-foreground':'340 24% 7%','--secondary':'340 19% 18%','--secondary-foreground':'340 30% 98%','--muted':'340 19% 18%','--muted-foreground':'340 12% 72%','--accent':'340 82% 64%','--accent-foreground':'340 24% 7%','--border':'340 16% 23%','--input':'340 16% 23%','--ring':'340 82% 64%',...common },
  },
  {
    id: 'midnight', name: 'Midnight', description: 'Indigo night',
    light: { '--background':'230 35% 98%','--foreground':'230 30% 12%','--card':'0 0% 100%','--card-foreground':'230 30% 12%','--popover':'0 0% 100%','--popover-foreground':'230 30% 12%','--primary':'231 90% 58%','--primary-foreground':'0 0% 100%','--secondary':'230 28% 93%','--secondary-foreground':'230 25% 15%','--muted':'230 28% 93%','--muted-foreground':'230 12% 43%','--accent':'231 90% 58%','--accent-foreground':'0 0% 100%','--border':'230 20% 87%','--input':'230 20% 87%','--ring':'231 90% 58%',...common },
    dark: { '--background':'230 45% 5%','--foreground':'225 30% 98%','--card':'230 36% 9%','--card-foreground':'225 30% 98%','--popover':'230 36% 9%','--popover-foreground':'225 30% 98%','--primary':'231 90% 68%','--primary-foreground':'230 45% 5%','--secondary':'230 29% 16%','--secondary-foreground':'225 30% 98%','--muted':'230 29% 16%','--muted-foreground':'225 14% 70%','--accent':'231 90% 68%','--accent-foreground':'230 45% 5%','--border':'230 23% 21%','--input':'230 23% 21%','--ring':'231 90% 68%',...common },
  },
  {
    id: 'amoled', name: 'AMOLED', description: 'True black',
    light: { '--background':'0 0% 100%','--foreground':'0 0% 5%','--card':'0 0% 98%','--card-foreground':'0 0% 5%','--popover':'0 0% 100%','--popover-foreground':'0 0% 5%','--primary':'142 76% 32%','--primary-foreground':'0 0% 100%','--secondary':'0 0% 94%','--secondary-foreground':'0 0% 9%','--muted':'0 0% 94%','--muted-foreground':'0 0% 42%','--accent':'142 76% 32%','--accent-foreground':'0 0% 100%','--border':'0 0% 86%','--input':'0 0% 86%','--ring':'142 76% 32%',...common },
    dark: { '--background':'0 0% 0%','--foreground':'0 0% 100%','--card':'0 0% 4%','--card-foreground':'0 0% 100%','--popover':'0 0% 4%','--popover-foreground':'0 0% 100%','--primary':'142 76% 45%','--primary-foreground':'0 0% 100%','--secondary':'0 0% 10%','--secondary-foreground':'0 0% 100%','--muted':'0 0% 10%','--muted-foreground':'0 0% 68%','--accent':'142 76% 45%','--accent-foreground':'0 0% 100%','--border':'0 0% 14%','--input':'0 0% 14%','--ring':'142 76% 45%',...common },
  },
  {
    id: 'sand', name: 'Sand', description: 'Warm neutral',
    light: { '--background':'40 35% 97%','--foreground':'35 22% 15%','--card':'40 40% 99%','--card-foreground':'35 22% 15%','--popover':'40 40% 99%','--popover-foreground':'35 22% 15%','--primary':'35 75% 40%','--primary-foreground':'0 0% 100%','--secondary':'38 30% 91%','--secondary-foreground':'35 22% 16%','--muted':'38 30% 91%','--muted-foreground':'35 12% 43%','--accent':'35 75% 40%','--accent-foreground':'0 0% 100%','--border':'35 22% 84%','--input':'35 22% 84%','--ring':'35 75% 40%',...common },
    dark: { '--background':'35 20% 8%','--foreground':'40 30% 97%','--card':'35 17% 12%','--card-foreground':'40 30% 97%','--popover':'35 17% 12%','--popover-foreground':'40 30% 97%','--primary':'35 80% 58%','--primary-foreground':'35 20% 8%','--secondary':'35 17% 19%','--secondary-foreground':'40 30% 97%','--muted':'35 17% 19%','--muted-foreground':'35 12% 70%','--accent':'35 80% 58%','--accent-foreground':'35 20% 8%','--border':'35 14% 24%','--input':'35 14% 24%','--ring':'35 80% 58%',...common },
  },
];

const DEFAULT_SETTINGS: AppearanceSettings = { mode: 'system', preset: 'default', radius: 'rounded' };

export function getStoredThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem('theme') as ThemeChoice | null;
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}

export function getStoredAppearance(): AppearanceSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem('ts-appearance');
    if (!raw) return { ...DEFAULT_SETTINGS, mode: getStoredThemeChoice() };
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      mode: parsed.mode === 'light' || parsed.mode === 'dark' || parsed.mode === 'system' ? parsed.mode : DEFAULT_SETTINGS.mode,
      preset: THEME_PRESETS.some(t => t.id === parsed.preset) ? parsed.preset as ThemePresetId : DEFAULT_SETTINGS.preset,
      radius: parsed.radius === 'compact' || parsed.radius === 'pill' ? parsed.radius : DEFAULT_SETTINGS.radius,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function hexToHsl(hex: string): string | null {
  const clean = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return `0 0% ${Math.round(l * 100)}%`;
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function setVariables(palette: ThemePalette, settings: AppearanceSettings) {
  const root = document.documentElement;
  Object.entries(palette).forEach(([key, value]) => root.style.setProperty(key, value));
  if (settings.accent) {
    const accent = hexToHsl(settings.accent);
    if (accent) {
      root.style.setProperty('--primary', accent);
      root.style.setProperty('--accent', accent);
      root.style.setProperty('--ring', accent);
    }
  }
  if (settings.background) {
    const background = hexToHsl(settings.background);
    if (background) {
      root.style.setProperty('--background', background);
      root.style.setProperty('--card', background);
      root.style.setProperty('--popover', background);
    }
  }
  const radius = settings.radius === 'compact' ? '0.45rem' : settings.radius === 'pill' ? '1rem' : '0.75rem';
  root.style.setProperty('--radius', radius);
}

export function applyAppearance(settings: AppearanceSettings) {
  const mode = settings.mode === 'system' ? getSystemTheme() : settings.mode;
  const preset = THEME_PRESETS.find(t => t.id === settings.preset) ?? THEME_PRESETS[0];
  const palette = mode === 'dark' ? preset.dark : preset.light;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(mode);
  root.style.colorScheme = mode;
  setVariables(palette, settings);
  localStorage.setItem('theme', settings.mode);
  localStorage.setItem('ts-appearance', JSON.stringify(settings));
}

export function applyTheme(choice: ThemeChoice) {
  const current = getStoredAppearance();
  applyAppearance({ ...current, mode: choice });
}

export function clearThemeInlineVariables() {
  const root = document.documentElement;
  THEME_PRESETS.forEach(preset => Object.keys(preset.light).forEach(key => root.style.removeProperty(key)));
  root.style.removeProperty('--radius');
}

export function getThemePreviewStyle(preset: ThemePreset, mode: 'light' | 'dark'): CSSProperties {
  const p = mode === 'dark' ? preset.dark : preset.light;
  return {
    backgroundColor: `hsl(${p['--background']})`,
    color: `hsl(${p['--foreground']})`,
    borderColor: `hsl(${p['--border']})`,
  };
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
