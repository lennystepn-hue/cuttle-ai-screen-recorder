import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import '../background-swatches.css';
import './shot.css';
import { Shot } from './Shot';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shot />
  </StrictMode>,
);
