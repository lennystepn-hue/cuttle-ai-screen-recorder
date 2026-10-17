import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './pill.css';
import { Pill } from './Pill';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Pill />
  </StrictMode>,
);
