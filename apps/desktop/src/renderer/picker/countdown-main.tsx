import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './picker.css';
import { Countdown } from './Countdown';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Countdown />
  </StrictMode>,
);
