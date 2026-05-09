import { ReactNode, MouseEvent } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function Card({ children, className = "", onClick }: CardProps) {
  return (
    <div
      className={`bg-card rounded-xl border border-border shadow-sm ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}