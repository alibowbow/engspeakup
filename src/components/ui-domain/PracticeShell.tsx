import type { ReactNode } from 'react';

export function PracticeShell({ showTools, children }: { showTools: boolean; children: ReactNode }) {
  return <div className={`practice-shell ${showTools ? 'practice-shell--tools' : ''}`}>{children}</div>;
}
