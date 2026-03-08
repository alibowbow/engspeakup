import type { ReactNode } from 'react';

export function AnalyticsView({ children }: { children: ReactNode }) {
  return <div className="analytics-layout">{children}</div>;
}
