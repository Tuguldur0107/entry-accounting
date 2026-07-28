// nextjs-port/components/auth/fields.tsx
'use client';

import * as React from 'react';
import { EyeIcon, EyeOffIcon } from './icons';

// =====================================================
// EAField — text/password input with icon, label, hint, error
// =====================================================
type FieldProps = {
  label: string;
  value: string;
  onChange: ((v: string) => void);
  placeholder?: string;
  type?: 'text' | 'email' | 'password';
  icon?: React.ReactNode;
  hint?: string;
  error?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
};

export function EAField({
  label, value, onChange, placeholder, type = 'text',
  icon, hint, error, autoComplete, autoFocus, onKeyDown,
}: FieldProps) {
  const [focused, setFocused] = React.useState(false);
  const [showPw, setShowPw] = React.useState(false);
  const isPw = type === 'password';
  const inputType = isPw && showPw ? 'text' : type;

  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--ea-text-2)',
          marginBottom: 6,
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </label>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          background: 'var(--ea-surface)',
          border: `1.5px solid ${error ? 'var(--ea-danger)' : focused ? 'var(--ea-primary)' : 'var(--ea-border-strong)'}`,
          borderRadius: 'var(--ea-r-md)',
          transition: 'all .15s ease',
          boxShadow: focused ? 'var(--ea-focus)' : 'none',
        }}
      >
        {icon && (
          <span
            style={{
              paddingLeft: 12,
              color: focused ? 'var(--ea-primary)' : 'var(--ea-text-4)',
              display: 'inline-flex',
            }}
          >
            {icon}
          </span>
        )}
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          style={{
            flex: 1,
            padding: '12px 14px',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontFamily: 'var(--ea-font-sans)',
            fontSize: 14,
            color: 'var(--ea-text-1)',
            borderRadius: 'var(--ea-r-md)',
          }}
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setShowPw((s) => !s)}
            style={{
              padding: '0 12px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--ea-text-3)',
              display: 'inline-flex',
            }}
            aria-label={showPw ? 'Hide password' : 'Show password'}
          >
            {showPw ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
      {hint && !error && (
        <div style={{ fontSize: 11, color: 'var(--ea-text-3)', marginTop: 4 }}>
          {hint}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: 'var(--ea-danger)', marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// =====================================================
// EAButton — primary / secondary, optional fullWidth + loading
// =====================================================
type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  fullWidth?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
};

export function EAButton({
  children, onClick, variant = 'primary',
  fullWidth, loading, disabled, type = 'button',
}: ButtonProps) {
  const [hover, setHover] = React.useState(false);

  const styles: React.CSSProperties = variant === 'primary'
    ? {
        background: hover && !disabled ? 'var(--ea-primary-700)' : 'var(--ea-primary)',
        color: 'var(--ea-hero-fg)',
        border: '1px solid var(--ea-primary)',
      }
    : {
        background: hover && !disabled ? 'var(--ea-bg-2)' : 'var(--ea-surface)',
        color: 'var(--ea-text-1)',
        border: '1px solid var(--ea-border-strong)',
      };

  return (
    <button
      type={type}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled || loading}
      style={{
        ...styles,
        padding: '11px 18px',
        borderRadius: 'var(--ea-r-md)',
        fontFamily: 'var(--ea-font-sans)',
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled || loading ? 0.6 : 1,
        width: fullWidth ? '100%' : 'auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        transition: 'all .15s ease',
        letterSpacing: '0.01em',
      }}
    >
      {children}
    </button>
  );
}

// =====================================================
// EACheckbox
// =====================================================
type CheckboxProps = {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
};

export function EACheckbox({ checked, onChange, children }: CheckboxProps) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        fontSize: 13,
        color: 'var(--ea-text-2)',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 16,
          height: 16,
          accentColor: 'var(--ea-primary)',
          cursor: 'pointer',
        }}
      />
      {children}
    </label>
  );
}
