import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { HTMLAttributes } from "react";

interface BackLinkProps extends HTMLAttributes<HTMLAnchorElement> {
  to: LinkProps["to"];
  label: string;
  hideIcon?: boolean;
  className?: string;
}

export const BackLink = ({ to, label, hideIcon = false, className, ...rest }: BackLinkProps) => {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-1 text-primary text-base underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-sm",
        className
      )}
      {...rest}
    >
      {!hideIcon && <ArrowLeft className="h-4 w-4" />}
      <span>{label}</span>
    </Link>
  );
};
