import React from 'react';
export const Button: React.FC<{ label: string }> = ({ label }) => {
  return <button>{label}</button>;
};
