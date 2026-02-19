import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc, createTRPCClient } from './trpc/index.js';
import { LocaleProvider } from './i18n/index.js';
import { App } from './components/App.js';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

const trpcClient = createTRPCClient();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <LocaleProvider>
          <App />
        </LocaleProvider>
      </QueryClientProvider>
    </trpc.Provider>
  </React.StrictMode>,
);
