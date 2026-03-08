import type { ReactNode } from 'react';

export function ReviewView({ children }: { children: ReactNode }) {
  return <div className="review-layout">{children}</div>;
}
