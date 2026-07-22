import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './store';
import './index.css';

// Apply the saved theme before first paint.
document.documentElement.dataset.theme = localStorage.getItem('uno.theme') || 'classic';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>
);
