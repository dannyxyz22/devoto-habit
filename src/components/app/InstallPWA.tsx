import { usePWA } from "@/hooks/usePWA";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { useState } from "react";

export const InstallPWA = () => {
  const { isInstallable, installApp } = usePWA();
  const [dismissed, setDismissed] = useState(false);

  if (!isInstallable || dismissed) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:max-w-sm bg-card border rounded-lg shadow-lg p-4 z-50">
      <div className="flex items-start gap-3">
        <Download className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm">Instalar Ignis Verbi</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Instale o app para ter acesso rápido e funcionar offline
          </p>
          <div className="flex gap-2 mt-3">
            <Button 
              onClick={installApp}
              size="sm"
              className="h-8 px-3 text-xs"
            >
              Instalar
            </Button>
            <Button 
              onClick={() => setDismissed(true)}
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs"
            >
              Mais tarde
            </Button>
          </div>
        </div>
        <Button
          onClick={() => setDismissed(true)}
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 flex-shrink-0"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};