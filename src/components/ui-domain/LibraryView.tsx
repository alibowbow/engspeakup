import type { ReactNode } from 'react';

export function LibraryView({ children }: { children: ReactNode }) {
  return <div className="library-layout">{children}</div>;
}
