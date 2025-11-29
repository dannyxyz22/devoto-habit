import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { usePWA } from "@/hooks/usePWA";
import { InstallPWA } from "@/components/app/InstallPWA";
import { AuthCallbackHandler } from "@/components/auth/AuthCallbackHandler";

import Index from "./pages/Index";
import Login from "./pages/Login";
import Library from "./pages/Library";
import Reader from "./pages/Reader";
import EpubReader from "./pages/EpubReader";
import PhysicalBookTracker from "./pages/PhysicalBookTracker";
import Stats from "./pages/Stats";
import NotFound from "./pages/NotFound";
import { ThemeProvider } from "next-themes";
import { Capacitor } from "@capacitor/core";

const App = () => {
  // Initialize PWA functionality
  usePWA();

  const isNative = (Capacitor.isNativePlatform?.() ?? (Capacitor.getPlatform?.() !== 'web')) as boolean;
  const baseName = isNative ? "/" : import.meta.env.BASE_URL;

  return (
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <BrowserRouter basename={baseName}>
          <AuthCallbackHandler />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/biblioteca" element={<Library />} />
            <Route path="/leitor/:bookId" element={<Reader />} />
            <Route path="/epub/:epubId" element={<EpubReader />} />
            <Route path="/physical/:bookId" element={<PhysicalBookTracker />} />
            <Route path="/estatisticas" element={<Stats />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <InstallPWA />
        </BrowserRouter>
      </ThemeProvider>
    </TooltipProvider>
  );
};

export default App;
