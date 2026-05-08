// nextjs-port/components/auth/icons.tsx
import * as React from 'react';

const baseProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

type IconProps = React.SVGProps<SVGSVGElement>;

export const MailIcon = (p: IconProps) => (
  <svg {...baseProps} {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

export const LockIcon = (p: IconProps) => (
  <svg {...baseProps} {...p}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

export const BuildingIcon = (p: IconProps) => (
  <svg {...baseProps} {...p}>
    <rect x="4" y="3" width="16" height="18" rx="1" />
    <path d="M9 8h.01M9 12h.01M9 16h.01M15 8h.01M15 12h.01M15 16h.01" />
  </svg>
);

export const ShieldIcon = (p: IconProps) => (
  <svg {...baseProps} {...p}>
    <path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6l-8-3z" />
  </svg>
);

export const ArrowRightIcon = (p: IconProps) => (
  <svg {...baseProps} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const CheckIcon = (p: IconProps) => (
  <svg {...baseProps} {...p}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

export const EyeIcon = (p: IconProps) => (
  <svg {...baseProps} {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <svg {...baseProps} {...p}>
    <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.5 5.6A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3.7 4.4M6.6 6.6A16 16 0 0 0 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.7" />
  </svg>
);
