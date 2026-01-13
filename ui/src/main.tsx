import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { ToastContainer } from './components/Toast'
import { ThemeProvider } from './contexts/ThemeContext'
import App from './App'
import './styles/global.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute - data is fresh for 1 minute
      gcTime: 1000 * 60 * 5, // 5 minutes - garbage collect after 5 minutes
      retry: 1,
      refetchOnWindowFocus: false, // Prevent refetch on tab focus
      refetchOnReconnect: true, // Refetch when network reconnects
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
          <ToastContainer />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
