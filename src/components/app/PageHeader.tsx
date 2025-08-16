import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const PageHeader = ({ title }: { title: string }) => {
  return (
    <header className="mb-8">
      <div className="flex items-center gap-4 mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link to="/" className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Voltar ao início
          </Link>
        </Button>
      </div>
      <h1 className="text-3xl font-bold">{title}</h1>
    </header>
  );
};