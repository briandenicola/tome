import { ArrowLeft, LucideIcon } from "lucide-react";
import Link from "next/link";
import { ReactNode } from "react";

interface PageHeaderProps {
  title: string | ReactNode;
  subtitle?: string | ReactNode;
  icon?: LucideIcon;
  customIcon?: ReactNode;
  backLink?: {
    href: string;
    label: string;
  };
  actions?: ReactNode;
}

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  customIcon,
  backLink,
  actions,
}: PageHeaderProps) {
  return (
    <div className="border-b border-[var(--border-color)] pb-6">
      {backLink && (
        <Link
          href={backLink.href}
          className="inline-flex items-center gap-2 text-[var(--accent)] hover:text-[var(--light-accent)] mb-5 font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {backLink.label}
        </Link>
      )}
      {/* On a phone the actions go under the title: beside it, they squeeze the title until a word overflows. The gap
          is a margin on the actions themselves, so an action hidden on phones leaves no empty space. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold flex items-center gap-3 sm:gap-4">
            {customIcon ? (
              customIcon
            ) : Icon ? (
              <Icon className="w-8 h-8 text-[var(--subheading-text)] flex-shrink-0" />
            ) : null}
            <span className="text-[var(--heading-text)] min-w-0 break-words">{title}</span>
          </h1>
          {subtitle && (
            <p className="text-base text-[var(--subheading-text)] mt-2 font-medium">
              {subtitle}
            </p>
          )}
        </div>
        {actions && <div className="flex-shrink-0 sm:self-center [&>*]:mt-4 sm:[&>*]:mt-0">{actions}</div>}
      </div>
    </div>
  );
}
