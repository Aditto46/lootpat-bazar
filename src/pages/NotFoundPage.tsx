import { ArrowLeft, Compass } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { Link } from "../lib/router";
import { primaryButtonClass } from "../components/auth/AuthShell";
import { cn } from "@/lib/utils";

export function NotFoundPage() {
  const { t, lang } = useI18n();

  return (
    <div className="container-page flex min-h-[62vh] items-center justify-center py-16">
      <div className="relative max-w-md text-center">
        <p
          aria-hidden="true"
          className="text-[5.5rem] font-black leading-none tracking-tighter text-transparent [-webkit-text-stroke:1.5px_var(--site-border)] sm:text-[7rem]"
        >
          {lang === "bn" ? "৪০৪" : "404"}
        </p>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{t("auth.notFoundTitle")}</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {t("auth.notFoundBody")}
        </p>
        <Link to="/" className={cn(primaryButtonClass, "mx-auto mt-6 w-auto px-6")}>
          {t("auth.backHome")}
          <ArrowLeft aria-hidden="true" className="size-4 rotate-180" />
        </Link>
        <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Compass aria-hidden="true" className="size-3.5" />
          LootPat Bazar
        </p>
      </div>
    </div>
  );
}
