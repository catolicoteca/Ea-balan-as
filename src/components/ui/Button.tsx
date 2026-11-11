import React from 'react';
import { Loader2 } from 'lucide-react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  className = '',
  disabled,
  style,
  ...rest
}) => {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-5 py-2.5 text-sm gap-2',
  }[size];

  const variantClasses = {
    primary:
      'text-white shadow-sm hover:opacity-95 focus-visible:ring-teal-600',
    secondary:
      'bg-slate-800 text-white hover:bg-slate-900 shadow-sm focus-visible:ring-slate-700',
    outline:
      'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400',
    ghost:
      'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400',
    danger:
      'bg-red-600 text-white hover:bg-red-700 shadow-sm focus-visible:ring-red-600',
  }[variant];

  const dynamicStyle =
    variant === 'primary'
      ? { backgroundColor: 'var(--brand-primary, #0D9488)', ...style }
      : style;

  return (
    <button
      disabled={disabled || isLoading}
      style={dynamicStyle}
      className={`inline-flex items-center justify-center font-medium rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-55 disabled:cursor-not-allowed ${sizeClasses} ${variantClasses} ${className}`}
      {...rest}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin shrink-0" />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      <span>{children}</span>
    </button>
  );
};
