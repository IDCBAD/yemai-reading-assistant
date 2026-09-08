import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startUiPerformanceMeasure } from './performanceTelemetry';
import './styles.css';
import { installPanelDiagnostics } from '../shared/lifecycleDiagnostics';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Side panel root element was not found.');
}

startUiPerformanceMeasure('sidepanel-shell');
installPanelDiagnostics();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
