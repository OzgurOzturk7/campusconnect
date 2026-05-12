import { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = "", ...rest }: CardProps) {
  return (
    <div
      className={`bg-card rounded-xl border border-border shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
