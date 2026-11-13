import { ArrowRight, Flame, MousePointer2, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { productAlt, productPrice, showcaseProduct, useCatalog } from "../../lib/catalog";
import { formatTaka, useI18n } from "../../lib/i18n";
import { Link } from "../../lib/router";
import { Magnetic } from "../common/Magnetic";

const HeroScene = lazy(() => import("./HeroScene"));

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl")),
    );
  } catch {
    return false;
  }
}

function HeroPoster({ dimmed }: { dimmed: boolean }) {
  const { t, lang } = useI18n();
  const { products } = useCatalog();
  const product = showcaseProduct(products);

  return (
    <div
      className={cn(
        "absolute inset-0 grid place-items-center transition-opacity duration-700",
        dimmed ? "opacity-0" : "opacity-100",
      )}
    >
      <div className="relative size-[76%] rounded-full border border-[var(--site-border)] bg-[var(--glass-fill)] p-4 shadow-[var(--shadow-card)] backdrop-blur-xl sm:p-6">
        <div
          aria-hidden="true"
          className="absolute inset-0 animate-[spin_22s_linear_infinite] rounded-full bg-[conic-gradient(from_0deg,transparent,rgba(0,245,212,0.3),transparent_38%,rgba(123,97,255,0.3),transparent)] opacity-70"
        />
        <div className="relative size-full overflow-hidden rounded-full border border-[var(--site-border)]">
          {product ? (
            <img
              src={product.image}
              srcSet={`${product.imageSmall} 450w, ${product.image} 900w`}
              sizes="(min-width: 1024px) 34vw, 76vw"
              alt={productAlt(product, lang)}
              width={900}
              height={900}
              fetchPriority="high"
              decoding="async"
              className="size-full object-cover"
            />
          ) : null}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,transparent_35%,rgba(11,11,16,0.45))]" />
        </div>
      </div>
      <p className="sr-only">{t("hero.loading")}</p>
    </div>
  );
}

function HeroVisual() {
  const { t, lang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [sceneAllowed, setSceneAllowed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [inView, setInView] = useState(true);
  const { products } = useCatalog();
  const product = showcaseProduct(products);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cores = navigator.hardwareConcurrency ?? 8;
    const memory =
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (reduceMotion || cores < 4 || memory < 4 || !supportsWebGL()) return;

    // Keep the poster as the LCP image and mount WebGL once the page is idle.
    let idleHandle = 0;
    let timeoutHandle = 0;
    const start = () => setSceneAllowed(true);
    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(start, { timeout: 2500 });
    } else {
      timeoutHandle = window.setTimeout(start, 1400);
    }
    return () => {
      if (idleHandle) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle) window.clearTimeout(timeoutHandle);
    };
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative mx-auto aspect-square w-full max-w-[33rem]">
      <div
        aria-hidden="true"
        className="absolute inset-[12%] rounded-full bg-[radial-gradient(circle,rgba(0,245,212,0.22),rgba(123,97,255,0.14)_45%,transparent_70%)] blur-2xl"
      />

      <HeroPoster dimmed={sceneReady} />

      {sceneAllowed ? (
        <div
          className={cn(
            "absolute inset-0 transition-opacity duration-1000",
            sceneReady ? "opacity-100" : "opacity-0",
          )}
        >
          <Suspense fallback={null}>
            <HeroScene active={inView} onReady={() => setSceneReady(true)} />
          </Suspense>
        </div>
      ) : null}

      {product ? (
        <Link
          to={`/product/${product.slug}`}
          className="glass card-hover absolute bottom-1 left-1/2 flex w-[78%] max-w-[16.5rem] -translate-x-1/2 items-center gap-3 rounded-[var(--radius-card)] p-2.5 pr-4 sm:bottom-6 sm:left-0 sm:translate-x-0"
        >
          <img
            src={product.imageSmall}
            alt=""
            width={450}
            height={450}
            loading="lazy"
            decoding="async"
            className="size-12 shrink-0 rounded-xl object-cover"
          />
          <span className="min-w-0">
            <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.22em] text-[var(--accent-ink)]">
              {t("hero.showcaseLabel")}
            </span>
            <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
              {product.name[lang]}
            </span>
            <span className="block text-xs text-muted-foreground">
              {formatTaka(productPrice(product), lang)}
            </span>
          </span>
          <ArrowRight aria-hidden="true" className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </Link>
      ) : null}

      {sceneAllowed ? (
        <span className="glass-soft absolute top-2 right-0 hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.65rem] text-muted-foreground sm:inline-flex">
          <MousePointer2 aria-hidden="true" className="size-3.5 text-[var(--accent-ink)]" />
          {t("hero.hint")}
        </span>
      ) : null}
    </div>
  );
}

export function Hero() {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 22 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section id="top" className="relative overflow-hidden pt-10 pb-14 sm:pt-14 lg:pt-16 lg:pb-24">
      <div className="container-page grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-6">
        <div className="relative z-10">
          <motion.span
            {...rise(0.05)}
            className="glass-soft inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-foreground"
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--brand-teal)] opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-[var(--brand-teal)]" />
            </span>
            <Sparkles aria-hidden="true" className="size-3.5 text-[var(--accent-ink)]" />
            {t("hero.eyebrow")}
          </motion.span>

          <motion.h1
            {...rise(0.12)}
            className="mt-5 text-[2.5rem] leading-[1.12] font-bold sm:text-5xl lg:text-[3.6rem] xl:text-[4.1rem]"
          >
            {t("hero.titleLine1")}
            <br />
            <span className="text-gradient">{t("hero.titleLine2")}</span>
          </motion.h1>

          <motion.p
            {...rise(0.2)}
            className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            {t("hero.body")}
          </motion.p>

          <motion.div {...rise(0.28)} className="mt-8 flex flex-wrap items-center gap-3">
            <Magnetic>
              <a
                href="#featured"
                className="btn-sheen inline-flex h-12 items-center gap-2 rounded-full bg-[var(--site-accent)] px-6 text-sm font-semibold text-[var(--site-on-accent)] shadow-[0_20px_55px_-20px_rgba(0,245,212,0.6)] transition hover:brightness-105"
              >
                {t("hero.ctaPrimary")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
            </Magnetic>
            <Magnetic strength={0.16}>
              <a
                href="#deals"
                className="glass-soft inline-flex h-12 items-center gap-2 rounded-full px-5 text-sm font-semibold text-foreground transition hover:border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)]"
              >
                <Flame aria-hidden="true" className="size-4 text-[var(--brand-rose)]" />
                {t("hero.ctaSecondary")}
              </a>
            </Magnetic>
          </motion.div>

          <motion.dl
            {...rise(0.36)}
            className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-[var(--site-border)] pt-6"
          >
            {[
              { value: t("hero.statDistricts"), label: t("hero.statDistrictsLabel") },
              { value: t("hero.statSupport"), label: t("hero.statSupportLabel") },
              { value: t("hero.statReturn"), label: t("hero.statReturnLabel") },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col">
                <dt className="order-2 mt-0.5 text-xs text-muted-foreground">{stat.label}</dt>
                <dd className="font-heading text-xl font-semibold text-foreground sm:text-2xl">
                  {stat.value}
                </dd>
              </div>
            ))}
          </motion.dl>
        </div>

        <motion.div
          {...(reduceMotion
            ? {}
            : {
                initial: { opacity: 0, scale: 0.94 },
                animate: { opacity: 1, scale: 1 },
                transition: { duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] as const },
              })}
          className="relative"
        >
          <HeroVisual />
        </motion.div>
      </div>
    </section>
  );
}
