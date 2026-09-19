import { useState, useEffect } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyAppearance, getStoredAppearance, type ThemeChoice } from '@/theme/themes';

export type { ThemeChoice } from '@/theme/themes';

export function getStoredThemeChoice(): ThemeChoice {
  return getStoredAppearance().mode;
}

export function applyTheme(choice: ThemeChoice) {
  applyAppearance({ ...getStoredAppearance(), mode: choice });
}

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    const appearance = getStoredAppearance();
    setChoice(appearance.mode);
    applyAppearance(appearance);
    if (appearance.mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyAppearance(getStoredAppearance());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggle = () => {
    const next: ThemeChoice = choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light';
    const appearance = { ...getStoredAppearance(), mode: next };
    setChoice(next);
    applyAppearance(appearance);
  };

  const effectiveTheme = choice === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : choice;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      className="rounded-full h-9 px-2.5 gap-1.5 text-xs font-semibold"
      title={`Theme: ${choice} (click to cycle)`}
      aria-label="Toggle theme"
    >
      {effectiveTheme === 'dark' ? (
        <Moon className="w-4 h-4 text-blue-400" />
      ) : choice === 'system' ? (
        <Monitor className="w-4 h-4 text-muted-foreground" />
      ) : (
        <Sun className="w-4 h-4 text-yellow-500" />
      )}
      <span className="hidden sm:inline text-muted-foreground capitalize">{choice}</span>
    </Button>
  );
}
