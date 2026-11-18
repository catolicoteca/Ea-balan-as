import React from 'react';
import { Sun, Moon, Laptop } from 'lucide-react';
import { useTheme, type ThemeMode } from '../../contexts/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  variant?: 'button' | 'dropdown' | 'compact';
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  className = '',
  variant = 'button',
}) => {
  const { theme, setTheme, resolvedTheme } = useTheme();

  const labels: Record<ThemeMode, string> = {
    light: 'Modo Claro',
    dark: 'Modo Escuro',
    system: 'Automático (Sistema)',
  };

  if (variant === 'compact') {
    return (
      <div className={`inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 ${className}`}>
        <button
          type="button"
          onClick={() => setTheme('light')}
          className={`p-1.5 rounded-md transition-colors ${
            theme === 'light'
              ? 'bg-white dark:bg-slate-700 text-amber-500 shadow-xs'
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
          }`}
          title="Modo Claro"
          aria-label="Modo Claro"
        >
          <Sun className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setTheme('dark')}
          className={`p-1.5 rounded-md transition-colors ${
            theme === 'dark'
              ? 'bg-white dark:bg-slate-700 text-teal-400 shadow-xs'
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
          }`}
          title="Modo Escuro"
          aria-label="Modo Escuro"
        >
          <Moon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setTheme('system')}
          className={`p-1.5 rounded-md transition-colors ${
            theme === 'system'
              ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-100 shadow-xs'
              : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
          }`}
          title="Automático (Acompanhar Sistema)"
          aria-label="Automático (Acompanhar Sistema)"
        >
          <Laptop className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (theme === 'light') setTheme('dark');
        else if (theme === 'dark') setTheme('system');
        else setTheme('light');
      }}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors ${className}`}
      title={`Tema atual: ${labels[theme]}. Clique para alternar.`}
      aria-label={`Tema atual: ${labels[theme]}`}
    >
      {resolvedTheme === 'dark' ? (
        <Moon className="w-4 h-4 text-teal-400" />
      ) : (
        <Sun className="w-4 h-4 text-amber-500" />
      )}
      <span className="hidden sm:inline">
        {theme === 'system' ? 'Sistema' : theme === 'dark' ? 'Escuro' : 'Claro'}
      </span>
    </button>
  );
};
