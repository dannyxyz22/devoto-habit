import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { usePWA } from "@/hooks/usePWA";
import { InstallPWA } from "@/components/app/InstallPWA";

import Index from "./pages/Index";
import Library from "./pages/Library";
import Reader from "./pages/Reader";
import Stats from "./pages/Stats";
import NotFound from "./pages/NotFound";
import { ThemeProvider } from "next-themes";

const queryClient = new QueryClient();

const App = () => {
  // Initialize PWA functionality
  usePWA();
  
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
  <BrowserRouter basename={import.meta.env.BASE_URL}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/biblioteca" element={<Library />} />
            <Route path="/leitor/:bookId" element={<Reader />} />
            <Route path="/estatisticas" element={<Stats />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <InstallPWA />
        </BrowserRouter>
    </ThemeProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
