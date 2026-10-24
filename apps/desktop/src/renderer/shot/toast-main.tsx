import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './shot.css';
import { Toast } from './Toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toast />
  </StrictMode>,
);
