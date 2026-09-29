import { useEffect } from 'react';
import { useHashPage } from './lib/router.ts';
import { AppShell } from './components/layout/AppShell.tsx';
import { useCapabilities } from './hooks/speech.ts';
import { useRuntime } from './hooks/useRuntime.ts';
import { useStore } from './store/useStore.ts';
import { TransceiverPage } from './pages/TransceiverPage.tsx';
import { ConsolePage } from './pages/ConsolePage.tsx';

export default function App() {
  const page = useHashPage();
  const init = useStore((s) => s.init);

  useRuntime();
  useCapabilities();

  useEffect(() => {
    init();
  }, [init]);

  return (
    <AppShell>
      {page === 'transceiver' ? <TransceiverPage /> : null}
      {page === 'console' ? <ConsolePage /> : null}
    </AppShell>
  );
}
