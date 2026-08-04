"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "default" | "ghost" | "primary" | "danger";
type ButtonSize = "sm" | "md";

export function Button({
  variant = "default",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}) {
  return (
    <button className={`ui-button ui-button-${variant} ui-button-${size} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button className={`ui-icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
