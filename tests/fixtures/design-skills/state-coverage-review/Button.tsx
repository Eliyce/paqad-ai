import React from 'react';

interface Props {
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}

export const Button: React.FC<Props> = ({
  variant = 'primary',
  disabled,
  loading,
  onClick,
  children,
}) => {
  return (
    <button
      data-variant={variant}
      disabled={disabled}
      aria-disabled={disabled}
      className="focus-visible:outline-2 hover:bg-primary-600"
      onClick={onClick}
    >
      {loading ? <span>Loading…</span> : children}
    </button>
  );
};
