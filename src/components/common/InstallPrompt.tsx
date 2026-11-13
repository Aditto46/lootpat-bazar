import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { useI18n } from "../../lib/i18n";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "lp-install-dismissed";
const DISMISS_MS = 1000 * 60 * 60 * 24 * 30;

function recentlyDismissed() {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number.parseInt(raw, 10);
    return Number.isFinite(at) && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

function isStandalone() {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Offers the browser's install prompt on phones. iOS Safari has no programmatic
 * prompt, so it gets the Share → Add to Home Screen hint instead. A dismissal is
 * remembered for a month so the shop never nags.
 */
export function InstallPrompt() {
  const { lang } = useI18n();
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone() || recentlyDismissed()) return;
    const smallScreen = window.matchMedia("(max-width: 767px)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    if (!smallScreen && !coarsePointer) return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as InstallEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
    let timer = 0;
    if (isIos) {
      timer = window.setTimeout(() => {
        setIosHint(true);
        setVisible(true);
      }, 9000);
    }

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage can be unavailable in private mode */
    }
  };

  const install = async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setVisible(false);
    } catch {
      setVisible(false);
    }
  };

  if (!visible) return null;

  const copy =
    lang === "bn"
      ? {
          title: "লুটপাট বাজার অ্যাপ হিসেবে রাখুন",
          body: iosHint
            ? "Safari-তে নিচের Share বাটন চেপে “Add to Home Screen” বেছে নিন।"
            : "হোম স্ক্রিনে যোগ করলে এক ট্যাপে দোকান খুলবে — আলাদা অ্যাপ স্টোর লাগবে না।",
          cta: "ইনস্টল করুন",
          close: "ইনস্টল প্রস্তাব বন্ধ করুন",
        }
      : {
          title: "Keep LootPat Bazar on your home screen",
          body: iosHint
            ? "In Safari tap Share, then choose “Add to Home Screen”."
            : "Install the shop for one-tap opening — no app store needed.",
          cta: "Install",
          close: "Dismiss install offer",
        };

  return (
    <div
      role="region"
      aria-label={copy.title}
      className="glass fixed bottom-5 left-4 right-20 z-40 flex items-center gap-3 rounded-2xl border border-[var(--site-border)] p-3 shadow-2xl sm:bottom-6 sm:left-6 sm:right-auto sm:max-w-sm"
    >
      <img src="/icon-192.png" alt="" width={40} height={40} className="size-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-tight text-[var(--site-fg)]">{copy.title}</p>
        <p className="mt-0.5 text-xs leading-snug text-[var(--site-muted)]">{copy.body}</p>
        {iosHint ? null : (
          <button
            type="button"
            onClick={install}
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[var(--site-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--site-on-accent)] transition hover:brightness-110"
          >
            <Download className="size-3.5" aria-hidden="true" />
            {copy.cta}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={copy.close}
        className="self-start rounded-full p-1.5 text-[var(--site-muted)] transition hover:bg-white/10 hover:text-[var(--site-fg)]"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}
