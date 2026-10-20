import '@fontsource-variable/inter'
import '@fontsource-variable/manrope'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { I18nProvider } from './i18n/I18nContext'
import { readShareParams } from './lib/share'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider initial={readShareParams(window.location.search).lang}>
      <App />
    </I18nProvider>
  </StrictMode>,
)
