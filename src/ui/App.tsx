import { useStore, store } from './store';
import { MapView } from './MapView';
import { Loading, PickScreen, TitleScreen } from './screens';
import { ArmiesStrip, ChoiceModal, DebugOverlay, GameOver, LogPanel, Toast, TopBar, useHotkeys } from './hud';
import { SidePanel } from './panels';

export function App() {
  const phase = useStore((s) => s.phase);
  const error = useStore((s) => s.error);
  const hasMap = useStore((s) => s.ready !== null);
  useHotkeys();
  return (
    <div className="app">
      {hasMap && (phase === 'pick' || phase === 'playing') && <MapView />}
      {phase === 'title' && <TitleScreen />}
      {phase === 'loading' && <Loading />}
      {phase === 'pick' && <PickScreen />}
      {phase === 'playing' && (
        <>
          <TopBar />
          <ArmiesStrip />
          <SidePanel />
          <LogPanel />
          <ChoiceModal />
          <GameOver />
          <DebugOverlay />
        </>
      )}
      <Toast />
      {error && (
        <div className="modal-back">
          <div className="modal">
            <h2>Something broke</h2>
            <pre className="error">{error}</pre>
            <div className="options">
              <button onClick={() => store.set({ error: '' })}>
                <b>Dismiss</b>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
