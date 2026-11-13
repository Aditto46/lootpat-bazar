import { Copy, Gift, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDateTime, useI18n } from "../../lib/i18n";
import {
  getSpinConfig,
  marketingErrorKey,
  playSpin,
  visitorKey,
  type SpinPrize,
  type SpinResult,
} from "../../lib/marketing";
import { Reveal } from "../common/Reveal";
import { Eyebrow } from "../common/SectionHeading";

const RESULT_KEY = "lp-spin-result";
const SEGMENT_COLORS = ["#00F5D4", "#F5C451", "#9D8CFF", "#FF5C7A", "#4ADEDE", "#F0A868"];

type StoredResult = {
  prize: SpinPrize;
  couponCode: string;
  expiresAt: string | null;
};

function readResult(): StoredResult | null {
  try {
    const raw = window.localStorage.getItem(RESULT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredResult;
    return parsed && typeof parsed.couponCode === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function storeResult(result: StoredResult) {
  try {
    window.localStorage.setItem(RESULT_KEY, JSON.stringify(result));
  } catch {
    /* private mode: the coupon stays visible for this visit */
  }
}

function wheelGradient(count: number): string {
  const slice = 360 / Math.max(1, count);
  const stops = Array.from({ length: count }, (_, index) => {
    const color = SEGMENT_COLORS[index % SEGMENT_COLORS.length];
    return `${color} ${index * slice}deg ${(index + 1) * slice}deg`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

export function SpinWheel() {
  const { t, lang } = useI18n();
  const [config, setConfig] = useState<{ enabled: boolean; prizes: SpinPrize[] } | null>(null);
  const [result, setResult] = useState<StoredResult | null>(() => readResult());
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getSpinConfig(controller.signal)
      .then(setConfig)
      .catch(() => setConfig(null));
    return () => controller.abort();
  }, []);

  const prizes = config?.prizes ?? [];
  const gradient = useMemo(() => wheelGradient(prizes.length || 4), [prizes.length]);

  if (!config || !config.enabled || prizes.length === 0) return null;

  const spin = async () => {
    if (spinning || result) return;
    setSpinning(true);
    try {
      const response: SpinResult = await playSpin(visitorKey());
      const index = Math.max(
        0,
        prizes.findIndex((prize) => prize.id === response.prize.id),
      );
      const slice = 360 / prizes.length;
      const target = 360 * 5 + (360 - (index * slice + slice / 2));
      setRotation(target);
      await new Promise((resolve) => window.setTimeout(resolve, 2800));
      const stored: StoredResult = {
        prize: response.prize,
        couponCode: response.couponCode,
        expiresAt: response.coupon?.expiresAt ?? null,
      };
      setResult(stored);
      storeResult(stored);
      if (response.alreadyPlayed) toast.message(t("spin.played"));
    } catch (cause) {
      toast.error(t(marketingErrorKey(cause)));
    } finally {
      setSpinning(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t("spin.copied"));
    } catch {
      toast.message(code);
    }
  };

  return (
    <section className="container-page py-8 sm:py-12" aria-labelledby="spin-title">
      <Reveal>
        <div className="relative overflow-hidden rounded-[calc(var(--radius-card)+0.4rem)] border border-[var(--site-border)] bg-[var(--glass-fill)] p-6 backdrop-blur-xl sm:p-9 lg:p-10">
          <div
            aria-hidden="true"
            className="absolute -top-20 -left-16 size-64 rounded-full bg-[radial-gradient(circle,rgba(0,245,212,0.2),transparent_65%)] blur-2xl"
          />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto]">
            <div>
              <Eyebrow>
                <Sparkles aria-hidden="true" className="size-3.5" />
                {t("spin.eyebrow")}
              </Eyebrow>
              <h2 id="spin-title" className="mt-3 text-2xl font-bold sm:text-3xl">
                {t("spin.title")}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {t("spin.body")}
              </p>
              <p className="mt-2 text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
                {t("spin.once")}
              </p>

              {result ? (
                <div className="mt-5 max-w-sm rounded-2xl border border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--site-accent)_8%,transparent)] p-4">
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent-ink)]">
                    <Gift aria-hidden="true" className="size-3.5" />
                    {t("spin.won")}
                  </p>
                  <p className="mt-1 text-lg font-bold text-foreground">{result.prize.label[lang]}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-2.5 py-1 font-mono text-sm font-semibold tracking-wider text-foreground">
                      {result.couponCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyCode(result.couponCode)}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--site-border)] px-3 py-1 text-xs font-medium text-foreground hover:border-[var(--site-accent)]"
                    >
                      <Copy aria-hidden="true" className="size-3.5" />
                      {t("spin.copy")}
                    </button>
                  </div>
                  {result.expiresAt ? (
                    <p className="mt-2 text-[0.68rem] text-muted-foreground">
                      {t("spin.expires", { date: formatDateTime(result.expiresAt, lang) })}
                    </p>
                  ) : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void spin()}
                  disabled={spinning}
                  className="mt-5 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--site-accent)] px-6 text-sm font-semibold text-[var(--site-on-accent)] shadow-[0_20px_55px_-22px_rgba(0,245,212,0.65)] transition hover:brightness-105 disabled:opacity-70"
                >
                  {spinning ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Sparkles aria-hidden="true" className="size-4" />
                  )}
                  {spinning ? t("spin.spinning") : t("spin.spin")}
                </button>
              )}
            </div>

            <div className="relative mx-auto size-52 sm:size-64">
              <div
                aria-hidden="true"
                className="absolute inset-0 rounded-full shadow-[inset_0_0_0_8px_rgba(11,11,16,0.35)] transition-transform duration-[2600ms] ease-[cubic-bezier(0.15,0.9,0.15,1)]"
                style={{ transform: `rotate(${rotation}deg)` }}
              >
                <div className="absolute inset-0 rounded-full" style={{ backgroundImage: gradient }} />
                {prizes.map((prize, index) => {
                  const angle = (360 / prizes.length) * index + 180 / prizes.length;
                  return (
                    <span
                      key={prize.id}
                      className="absolute top-1/2 left-1/2 w-24 text-center text-[0.58rem] font-bold leading-tight text-[#0B0B10]"
                      style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-34%)` }}
                    >
                      {prize.label[lang]}
                    </span>
                  );
                })}
              </div>
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-[var(--surface-raised)] bg-[#0B0B10] text-[var(--accent-ink)]"
              >
                <Gift className="size-6" />
              </span>
              <span
                aria-hidden="true"
                className="absolute -top-2 left-1/2 size-0 -translate-x-1/2 border-x-8 border-t-[14px] border-x-transparent border-t-[var(--brand-gold)]"
              />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
