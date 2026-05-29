import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Home from "./pages/home";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 2,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route>
        <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-4">
          <h1 className="text-6xl font-display font-bold text-text-main mb-4">404</h1>
          <p className="text-xl text-text-muted mb-8">This page doesn't exist.</p>
          <a href="/" className="px-6 py-3 bg-surface hover:bg-surface-hover text-white rounded-xl font-medium transition-colors border border-border">
            Go back home
          </a>
        </div>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
