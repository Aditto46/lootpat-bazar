import { Camera, CheckCircle2, Loader2, MessageSquare, Star, ThumbsUp, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CatalogProduct } from "../../lib/catalog";
import { formatDateTime, formatNumber, useI18n } from "../../lib/i18n";
import {
  getProductReviews,
  marketingErrorKey,
  markReviewHelpful,
  submitReview,
  voterKey,
  type ProductReview,
  type ProductReviews,
} from "../../lib/marketing";

const PHOTO_LIMIT_BYTES = 300 * 1024;
const VOTE_KEY = "lp-helpful-votes";

function readVotes(): string[] {
  try {
    const raw = window.localStorage.getItem(VOTE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function rememberVote(reviewId: string) {
  try {
    window.localStorage.setItem(VOTE_KEY, JSON.stringify([...readVotes(), reviewId]));
  } catch {
    /* private mode keeps the vote only for this page */
  }
}

async function compressPhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("photo_type");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("photo_unsupported");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // Re-encoding through a canvas also drops EXIF, which the server rejects.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  if (dataUrl.length > PHOTO_LIMIT_BYTES * 1.37) throw new Error("photo_large");
  return dataUrl;
}

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={cn(
            "size-4",
            value <= Math.round(rating)
              ? "fill-[var(--brand-gold)] text-[var(--brand-gold)]"
              : "text-[var(--site-border)]",
          )}
        />
      ))}
    </span>
  );
}

function ReviewCard({
  review,
  voted,
  onVote,
}: {
  review: ProductReview;
  voted: boolean;
  onVote: (reviewId: string) => void;
}) {
  const { t, lang } = useI18n();
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <article className="rounded-2xl border border-[var(--site-border)] bg-[var(--surface-raised)] p-4 sm:p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Stars rating={review.rating} />
        <span className="text-xs font-semibold text-foreground">
          {formatNumber(review.rating, lang)}/5
        </span>
        {review.verifiedPurchase ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] px-2 py-0.5 text-[0.62rem] font-semibold text-[var(--accent-ink)]">
            <CheckCircle2 aria-hidden="true" className="size-3" />
            {t("reviews.verified")}
          </span>
        ) : null}
        <span className="ml-auto text-[0.68rem] text-muted-foreground">
          {formatDateTime(review.createdAt, lang)}
        </span>
      </header>

      <p className="mt-2.5 text-sm font-semibold text-foreground">{review.customerName}</p>
      {review.title ? (
        <p className="mt-1 text-sm font-medium text-foreground">{review.title}</p>
      ) : null}
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{review.body}</p>

      {review.photos.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {review.photos.map((photo, index) => (
            <li key={`${review.id}-${index}`}>
              <button
                type="button"
                onClick={() => setLightbox(photo)}
                className="block size-16 overflow-hidden rounded-xl border border-[var(--site-border)] sm:size-20"
                aria-label={`${t("reviews.photos")} — ${review.customerName}`}
              >
                <img
                  src={photo}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition hover:scale-105"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {review.reply ? (
        <div className="mt-3 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3">
          <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent-ink)]">
            <MessageSquare aria-hidden="true" className="size-3.5" />
            {t("reviews.replyFromStore")}
          </p>
          <p className="mt-1.5 text-sm text-foreground">{review.reply.body}</p>
        </div>
      ) : null}

      <footer className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onVote(review.id)}
          disabled={voted}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
            voted
              ? "border-[var(--site-accent)] text-[var(--accent-ink)]"
              : "border-[var(--site-border)] text-muted-foreground hover:border-[var(--accent-ink)] hover:text-foreground",
          )}
        >
          <ThumbsUp aria-hidden="true" className="size-3.5" />
          {t("reviews.helpful")}
          {review.helpfulCount > 0 ? ` · ${formatNumber(review.helpfulCount, lang)}` : null}
        </button>
      </footer>

      <Dialog open={lightbox !== null} onOpenChange={(open) => (open ? null : setLightbox(null))}>
        <DialogContent className="gap-0 overflow-hidden border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">{review.customerName}</DialogTitle>
          {lightbox ? (
            <img src={lightbox} alt="" className="max-h-[86vh] w-full rounded-2xl object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </article>
  );
}

function ReviewForm({ product, onDone }: { product: CatalogProduct; onDone: () => void }) {
  const { t } = useI18n();
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickPhoto = async (file: File | undefined) => {
    if (!file || photos.length >= 2) return;
    try {
      const dataUrl = await compressPhoto(file);
      setPhotos((current) => [...current, dataUrl].slice(0, 2));
      setError(null);
    } catch {
      setError(t("marketing.error.photo_exif_rejected"));
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submitReview({
        productId: product.id,
        orderNumber: orderNumber.trim().toUpperCase(),
        phone: phone.trim(),
        rating,
        title: title.trim() || undefined,
        body: body.trim(),
        photos,
      });
      toast.success(t("reviews.submitted"));
      onDone();
    } catch (cause) {
      setError(t(marketingErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <p className="text-xs leading-relaxed text-muted-foreground">{t("reviews.formBody")}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-muted-foreground">
          {t("reviews.orderNumber")}
          <input
            required
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            placeholder="LP-261113-ABC123"
            className="mt-1 h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          {t("reviews.phone")}
          <input
            required
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="01XXXXXXXXX"
            className="mt-1 h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
          />
        </label>
      </div>

      <fieldset>
        <legend className="text-xs font-medium text-muted-foreground">{t("reviews.rating")}</legend>
        <div className="mt-1.5 flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={rating === value}
              aria-label={t("reviews.star", { value })}
              onClick={() => setRating(value)}
              className="rounded-full p-1"
            >
              <Star
                className={cn(
                  "size-7 transition",
                  value <= rating
                    ? "fill-[var(--brand-gold)] text-[var(--brand-gold)]"
                    : "text-[var(--site-border)]",
                )}
              />
            </button>
          ))}
        </div>
      </fieldset>

      <label className="block text-xs font-medium text-muted-foreground">
        {t("reviews.titleLabel")}
        <input
          maxLength={80}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 h-10 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] px-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
        />
      </label>

      <label className="block text-xs font-medium text-muted-foreground">
        {t("reviews.bodyLabel")}
        <textarea
          required
          minLength={5}
          maxLength={1200}
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          className="mt-1 w-full rounded-lg border border-[var(--site-border)] bg-[var(--surface-raised)] p-3 text-sm text-foreground outline-none focus-visible:border-[var(--site-accent)]"
        />
      </label>

      <div>
        <p className="text-xs font-medium text-muted-foreground">{t("reviews.photos")}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {photos.map((photo, index) => (
            <span key={index} className="relative">
              <img
                src={photo}
                alt=""
                className="size-16 rounded-xl border border-[var(--site-border)] object-cover"
              />
              <button
                type="button"
                aria-label={t("reviews.removePhoto")}
                onClick={() => setPhotos((current) => current.filter((_, at) => at !== index))}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-[var(--danger-ink)] text-white"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </span>
          ))}
          {photos.length < 2 ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--site-border)] text-[0.6rem] text-muted-foreground hover:border-[var(--site-accent)]"
            >
              <Camera aria-hidden="true" className="size-4" />
              {t("reviews.addPhoto")}
            </button>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            void pickPhoto(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <p className="mt-1 text-[0.65rem] text-muted-foreground">{t("reviews.photoHint")}</p>
      </div>

      {error ? (
        <p role="alert" className="text-xs font-medium text-[var(--danger-ink)]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)] disabled:opacity-60"
        >
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {busy ? t("reviews.submitting") : t("reviews.submit")}
        </button>
        <p className="text-[0.65rem] text-muted-foreground">{t("reviews.verifiedNote")}</p>
      </div>
    </form>
  );
}

export function ReviewsSection({ product }: { product: CatalogProduct }) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<ProductReviews | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [voted, setVoted] = useState<string[]>(() => readVotes());
  const [formOpen, setFormOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    getProductReviews(product.slug, controller.signal)
      .then((response) => {
        setData(response);
        setStatus("ready");
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setStatus("error");
      });
    return () => controller.abort();
  }, [product.slug, nonce]);

  const vote = useCallback(
    async (reviewId: string) => {
      if (voted.includes(reviewId)) return;
      try {
        const response = await markReviewHelpful(reviewId, voterKey());
        rememberVote(reviewId);
        setVoted((current) => [...current, reviewId]);
        setData((current) =>
          current
            ? {
                ...current,
                reviews: current.reviews.map((review) =>
                  review.id === reviewId
                    ? { ...review, helpfulCount: response.helpfulCount }
                    : review,
                ),
              }
            : current,
        );
      } catch (cause) {
        toast.error(t(marketingErrorKey(cause)));
      }
    },
    [voted, t],
  );

  const summary = data?.summary;
  const average = summary ? summary.averageTenths / 10 : 0;

  return (
    <section
      aria-labelledby="reviews-title"
      className="mt-14 border-t border-[var(--site-border)] pt-10"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="reviews-title" className="font-heading text-xl font-bold text-foreground sm:text-2xl">
            {t("reviews.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("reviews.body")}</p>
        </div>
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--site-accent)] px-4 text-sm font-semibold text-[var(--accent-ink)] transition hover:bg-[color-mix(in_srgb,var(--site-accent)_12%,transparent)]"
        >
          <Star aria-hidden="true" className="size-4" />
          {t("reviews.write")}
        </button>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="glass rounded-2xl p-4">
          {summary && summary.count > 0 ? (
            <>
              <p className="font-heading text-4xl font-bold text-foreground">
                {formatNumber(average, lang)}
                <span className="ml-1 text-sm font-medium text-muted-foreground">
                  {t("reviews.outOf")}
                </span>
              </p>
              <Stars rating={average} className="mt-1.5" />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("reviews.count", { count: formatNumber(summary.count, lang) })}
              </p>
              <ul className="mt-4 space-y-1.5">
                {([5, 4, 3, 2, 1] as const).map((stars) => {
                  const value = summary.breakdown[String(stars) as "1" | "2" | "3" | "4" | "5"] ?? 0;
                  const percent = summary.count ? Math.round((value / summary.count) * 100) : 0;
                  return (
                    <li key={stars} className="flex items-center gap-2 text-[0.68rem] text-muted-foreground">
                      <span className="w-14 shrink-0">
                        {t("reviews.breakdown", { stars: formatNumber(stars, lang) })}
                      </span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                        <span
                          className="block h-full rounded-full bg-[var(--brand-gold)]"
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                      <span className="w-6 text-right">{formatNumber(value, lang)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("reviews.empty")}</p>
          )}
        </div>

        <div>
          {status === "loading" ? (
            <div className="space-y-3" aria-busy="true">
              <p className="sr-only" role="status">
                {t("common.loading")}
              </p>
              {[0, 1].map((index) => (
                <div key={index} className="h-28 animate-pulse rounded-2xl bg-[var(--surface-sunken)]" />
              ))}
            </div>
          ) : status === "error" ? (
            <button
              type="button"
              onClick={() => setNonce((current) => current + 1)}
              className="rounded-full border border-[var(--site-border)] px-4 py-2 text-sm text-foreground"
            >
              {t("shop.retry")}
            </button>
          ) : data && data.reviews.length > 0 ? (
            <ul className="space-y-3">
              {data.reviews.map((review) => (
                <li key={review.id}>
                  <ReviewCard review={review} voted={voted.includes(review.id)} onVote={(id) => void vote(id)} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--site-border)] p-8 text-center">
              <p className="text-sm text-muted-foreground">{t("reviews.empty")}</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
          <DialogTitle className="font-heading text-lg font-bold">{t("reviews.formTitle")}</DialogTitle>
          <ReviewForm
            product={product}
            onDone={() => {
              setFormOpen(false);
              setNonce((current) => current + 1);
            }}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}
