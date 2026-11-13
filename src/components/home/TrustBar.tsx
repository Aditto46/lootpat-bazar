import { Banknote, Headset, RotateCcw, Truck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "../../lib/i18n";
import { Reveal } from "../common/Reveal";

const items = [
  { icon: Truck, title: "trust.delivery", body: "trust.deliveryBody" },
  { icon: Banknote, title: "trust.cod", body: "trust.codBody" },
  { icon: RotateCcw, title: "trust.return", body: "trust.returnBody" },
  { icon: Headset, title: "trust.support", body: "trust.supportBody" },
] as const;

export function TrustBar() {
  const { t } = useI18n();

  return (
    <section aria-label={t("trust.delivery")} className="container-page py-4 sm:py-6">
      <Reveal>
        <div className="glass grid overflow-hidden rounded-[var(--radius-card)] sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, index) => (
            <div
              key={item.title}
              className={cn(
                "flex items-center gap-3 border-[var(--site-border)] p-4 sm:p-5",
                index === 1 && "border-t sm:border-t-0 sm:border-l",
                index === 2 && "border-t sm:border-t lg:border-t-0 lg:border-l",
                index === 3 && "border-t sm:border-l",
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--site-border)] bg-[color-mix(in_srgb,var(--site-accent)_10%,transparent)]">
                <item.icon aria-hidden="true" className="size-5 text-[var(--accent-ink)]" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-foreground">{t(item.title)}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{t(item.body)}</span>
              </span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
