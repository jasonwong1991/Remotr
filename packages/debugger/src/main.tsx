import React from 'react';
import ReactDOM from 'react-dom/client';
import './global.css';
import App from './App';
import { initializeTheme } from './theme';

initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
