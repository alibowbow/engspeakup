import type { ReactNode } from 'react';

export function TopBar({ children }: { children: ReactNode }) {
  return <header className="page-header">{children}</header>;
}
