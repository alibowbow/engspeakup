import { useState } from 'react';

export type PracticePanelTab = 'guide' | 'challenge' | 'suggestions' | 'analysis' | 'recap';

export function usePracticeUiContainer() {
  const [showScenarioPicker, setShowScenarioPicker] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [practicePanelTab, setPracticePanelTab] = useState<PracticePanelTab>('guide');
  const [showSettings, setShowSettings] = useState(false);

  const openPracticePanel = (tab: PracticePanelTab) => {
    setPracticePanelTab(tab);
    setShowTools(true);
  };

  const togglePracticePanel = (tab: PracticePanelTab) => {
    if (showTools && practicePanelTab === tab) {
      setShowTools(false);
      return;
    }
    openPracticePanel(tab);
  };

  return {
    showScenarioPicker,
    setShowScenarioPicker,
    showTools,
    setShowTools,
    practicePanelTab,
    setPracticePanelTab,
    showSettings,
    setShowSettings,
    openPracticePanel,
    togglePracticePanel,
  };
}
