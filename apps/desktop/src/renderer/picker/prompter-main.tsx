import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../base.css';
import './picker.css';
import { Prompter } from './Prompter';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Prompter />
  </StrictMode>,
);
