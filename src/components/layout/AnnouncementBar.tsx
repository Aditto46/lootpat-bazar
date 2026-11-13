import { Banknote, Sparkles, Truck } from "lucide-react";
import { useI18n } from "../../lib/i18n";

export function AnnouncementBar() {
  const { t } = useI18n();

  const items = [
    { icon: Truck, label: t("announce.delivery") },
    { icon: Banknote, label: t("announce.cod") },
    { icon: Sparkles, label: t("announce.freeShipping") },
  ];

  return (
    <div className="relative z-30 border-b border-[var(--site-border)] bg-[color-mix(in_srgb,var(--site-bg)_78%,transparent)] backdrop-blur-md">
      <div className="container-page flex h-9 items-center justify-center gap-5 text-[0.7rem] text-muted-foreground sm:text-xs">
        {items.map((item, index) => (
          <span
            key={item.label}
            className={
              index === 0
                ? "inline-flex items-center gap-1.5 text-foreground"
                : "hidden items-center gap-1.5 sm:inline-flex"
            }
          >
            <item.icon aria-hidden="true" className="size-3.5 text-[var(--accent-ink)]" />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
