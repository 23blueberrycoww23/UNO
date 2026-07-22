import { useApp } from './store';
import HomePage from './components/HomePage';
import LobbyPage from './components/LobbyPage';
import GamePage from './components/GamePage';

export default function App() {
  const app = useApp();

  return (
    <div className="app">
      {!app.connected && (
        <div className="conn-banner" role="status">
          Reconnecting to server…
        </div>
      )}

      {app.view === 'home' && <HomePage />}
      {app.view === 'lobby' && <LobbyPage />}
      {app.view === 'game' && <GamePage />}

      <div className="toasts" aria-live="polite">
        {app.toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
