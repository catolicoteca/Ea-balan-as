import React, { useState } from 'react';

interface BrandLogoProps {
  name?: string;
  subtitle?: string;
  logoUrl?: string | null;
  primaryColor?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'light' | 'dark';
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  name = 'Metrion',
  subtitle = 'Assistência Técnica & Metrologia',
  logoUrl,
  primaryColor = '#0D9488',
  size = 'md',
  variant = 'dark',
}) => {
  const [imgError, setImgError] = useState(false);

  const dims =
    size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  const titleClass =
    size === 'sm'
      ? 'text-sm font-bold'
      : size === 'lg'
        ? 'text-xl font-bold'
        : 'text-base font-bold';

  return (
    <div className="flex items-center gap-3 min-w-0">
      {logoUrl && !imgError ? (
        <img
          src={logoUrl}
          alt={`Logotipo ${name}`}
          onError={() => setImgError(true)}
          className={`${dims} rounded-lg object-contain bg-white p-1 border border-white/15 shrink-0`}
        />
      ) : (
        <div
          className={`${dims} rounded-lg flex items-center justify-center shrink-0 shadow-sm border border-white/15`}
          style={{ backgroundColor: primaryColor }}
          aria-hidden="true"
        >
          {/* Emblema geométrico de balança de precisão / metrologia */}
          <svg
            viewBox="0 0 32 32"
            fill="none"
            className="w-6 h-6 text-white"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M16 5V25M10 25H22M7 11H25"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M7 11L4.5 17.5C4.5 19.1569 5.84315 20.5 7.5 20.5C9.15685 20.5 10.5 19.1569 10.5 17.5L8 11"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinejoin="round"
            />
            <path
              d="M24 11L21.5 17.5C21.5 19.1569 22.8431 20.5 24.5 20.5C26.1569 20.5 27.5 19.1569 27.5 17.5L25 11"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="8" r="2" fill="currentColor" />
          </svg>
        </div>
      )}
      <div className="min-w-0">
        <div
          className={`${titleClass} truncate tracking-tight ${
            variant === 'dark' ? 'text-white' : 'text-slate-900'
          }`}
        >
          {name}
        </div>
        <div
          className={`text-[11px] font-medium truncate ${
            variant === 'dark' ? 'text-slate-300/85' : 'text-slate-500'
          }`}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
};
