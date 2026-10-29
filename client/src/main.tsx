import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import '@fontsource-variable/inter'
import './index.css'
import { ClipmunkStudioHost } from "./clipmunk/Studio";

createRoot(document.getElementById('root')!).render(
  <ClipmunkStudioHost>
    <StrictMode>
  		<App />
  	</StrictMode>
  </ClipmunkStudioHost>,
)
