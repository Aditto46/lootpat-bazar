import {
  ArrowUpRight,
  Backpack,
  Briefcase,
  Cpu,
  Headphones,
  Lamp,
  Package,
  PlugZap,
  Sparkles,
  Watch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "../../lib/router";
import { useCatalog } from "../../lib/catalog";
import { useI18n } from "../../lib/i18n";
import { Reveal } from "../common/Reveal";
import { SectionHeading } from "../common/SectionHeading";

const icons: Record<string, LucideIcon> = {
  Headphones,
  Watch,
  Briefcase,
  Backpack,
  Lamp,
  Sparkles,
  PlugZap,
  Cpu,
  Package,
};

const accents: Record<string, string> = {
  teal: "#00F5D4",
  violet: "#7B61FF",
  gold: "#F5C451",
  rose: "#FF5C7A",
};

export function CategoryTiles() {
  const { t, lang } = useI18n();
  const { categories, status } = useCatalog();

  return (
    <section id="categories" className="container-page py-14 sm:py-20">
      <SectionHeading
        eyebrow={t("categories.eyebrow")}
        title={t("categories.title")}
        body={t("categories.body")}
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {status === "loading" && categories.length === 0
          ? Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                aria-hidden="true"
                className="glass h-32 animate-pulse rounded-[var(--radius-card)]"
              />
            ))
          : categories.map((category, index) => {
              const Icon = icons[category.icon] ?? Package;
              const color = accents[category.accent] ?? "#00F5D4";
              return (
                <Reveal key={category.id} delay={index * 0.05} className="h-full">
                  <Link
                    to={`/shop?category=${category.id}`}
                    className="glass card-hover group relative flex h-full flex-col gap-3 overflow-hidden rounded-[var(--radius-card)] p-4"
                  >
                    <span
                      aria-hidden="true"
                      className="absolute -right-8 -bottom-10 size-24 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-40"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className="grid size-11 place-items-center rounded-2xl border"
                      style={{
                        color,
                        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
                        borderColor: `color-mix(in srgb, ${color} 28%, transparent)`,
                      }}
                    >
                      <Icon aria-hidden="true" className="size-5" />
                    </span>
                    <span className="mt-auto">
                      <span className="block font-heading text-sm font-semibold text-foreground">
                        {category.name[lang]}
                      </span>
                      <span className="mt-0.5 block text-[0.7rem] leading-snug text-muted-foreground">
                        {category.blurb[lang]}
                      </span>
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="absolute top-3 right-3 size-4 text-muted-foreground opacity-0 transition group-hover:opacity-100"
                    />
                  </Link>
                </Reveal>
              );
            })}
      </div>
    </section>
  );
}
