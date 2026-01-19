import { Component, ErrorInfo, ReactNode } from "react";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false
    };

    public static getDerivedStateFromError(_: Error): State {
        return { hasError: true };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        logger.logError(error, { componentStack: errorInfo.componentStack });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-center">
                    <div className="max-w-md space-y-4 rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
                        <h1 className="text-2xl font-bold text-destructive">Algo deu errado</h1>
                        <p className="text-muted-foreground">
                            Desculpe, ocorreu um erro inesperado. Nosso time já foi notificado.
                        </p>
                        <div className="pt-4">
                            <Button
                                onClick={() => window.location.reload()}
                                className="w-full"
                            >
                                Recarregar página
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
