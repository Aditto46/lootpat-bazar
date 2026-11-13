import { Check, MessageSquare, RefreshCw, Star, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FormAlert,
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import { adminErrorKey } from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { formatDateTime, formatNumber, useI18n, type DictKey } from "../../lib/i18n";
import {
  loadAdminReviews,
  updateAdminReview,
  type AdminReview,
  type AdminReviewStatus,
  type AdminReviewsResponse,
} from "../../lib/marketing";
import { cn } from "@/lib/utils";
import { AdminShell, Panel } from "./AdminShell";

type Filter = AdminReviewStatus | "all";

const FILTERS: Array<{ id: Filter; label: DictKey }> = [
  { id: "pending", label: "admin.reviews.pending" },
  { id: "approved", label: "admin.reviews.approved" },
  { id: "rejected", label: "admin.reviews.rejected" },
  { id: "all", label: "admin.reviews.all" },
];

const STATUS_TONES: Record<AdminReviewStatus, string> = {
  pending: "border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] text-[var(--brand-gold)]",
  approved: "border-[color-mix(in_srgb,var(--site-accent)_55%,transparent)] text-[var(--accent-ink)]",
  rejected: "border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] text-[var(--danger-ink)]",
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} / 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          aria-hidden="true"
          className={cn(
            "size-3.5",
            value <= rating ? "fill-[var(--brand-gold)] text-[var(--brand-gold)]" : "text-[var(--site-border)]",
          )}
        />
      ))}
    </span>
  );
}

export function ReviewsPage() {
  const { t, lang } = useI18n();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission("reviews.write");

  const [filter, setFilter] = useState<Filter>("pending");
  const [data, setData] = useState<AdminReviewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadAdminReviews(filter === "all" ? undefined : filter);
      setData(result);
      setReplies(
        Object.fromEntries(result.reviews.map((review) => [review.id, review.reply ?? ""])),
      );
      setError(null);
    } catch (cause) {
      setError(t(adminErrorKey(cause)));
    } finally {
      setLoading(false);
    }
  }, [filter, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(review: AdminReview, input: { status?: "approved" | "rejected"; reply?: string }) {
    setBusyId(review.id);
    try {
      await updateAdminReview(review.id, input);
      toast.success(t(input.status ? "admin.marketing.updated" : "admin.reviews.replySaved"));
      await load();
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusyId(null);
    }
  }

  const counts = data?.counts ?? { pending: 0, approved: 0, rejected: 0 };

  return (
    <AdminShell
      eyebrow={t("admin.reviews.eyebrow")}
      title={t("admin.reviews.title")}
      body={t("admin.reviews.body")}
      actions={
        <button type="button" onClick={() => void load()} disabled={loading} className={secondaryButtonClass}>
          <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
          {t("admin.refresh")}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((entry) => {
          const count = entry.id === "all"
            ? counts.pending + counts.approved + counts.rejected
            : counts[entry.id];
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              aria-pressed={filter === entry.id}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                filter === entry.id
                  ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_14%,transparent)] text-foreground"
                  : "border-[var(--site-border)] text-muted-foreground hover:text-foreground",
              )}
            >
              {t(entry.label)}
              <span className="rounded-full bg-[var(--surface-sunken)] px-1.5 text-[0.65rem] font-semibold">
                {formatNumber(count, lang)}
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mt-4">
          <FormAlert message={error} />
        </div>
      ) : null}

      {loading && !data ? (
        <div className="mt-5 space-y-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-28 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
          ))}
        </div>
      ) : null}

      {data && data.reviews.length === 0 ? (
        <Panel className="mt-5 flex items-center gap-3 text-sm text-muted-foreground">
          <MessageSquare aria-hidden="true" className="size-4" />
          {t("admin.reviews.empty")}
        </Panel>
      ) : null}

      {data && data.reviews.length > 0 ? (
        <ul className="mt-5 space-y-3">
          {data.reviews.map((review) => (
            <li key={review.id} className="glass rounded-2xl p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {review.productName[lang] || "—"}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
                    <Stars rating={review.rating} />
                    <span>{review.customerName}</span>
                    <span dir="ltr">{review.phone}</span>
                    <span>
                      {t("admin.reviews.order")}: <span dir="ltr">{review.orderNumber}</span>
                    </span>
                    <span>{formatDateTime(review.createdAt, lang)}</span>
                    {review.verifiedPurchase ? (
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--brand-teal)_14%,transparent)] px-2 py-0.5 text-[0.62rem] font-semibold text-[var(--brand-teal)]">
                        {t("admin.reviews.verified")}
                      </span>
                    ) : null}
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold",
                    STATUS_TONES[review.status],
                  )}
                >
                  {t(`admin.reviews.${review.status}` as DictKey)}
                </span>
              </div>

              {review.title ? (
                <p className="mt-3 text-sm font-semibold text-foreground">{review.title}</p>
              ) : null}
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{review.body}</p>

              {review.photos.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {review.photos.map((photo, index) => (
                    <a
                      key={`${review.id}-photo-${index}`}
                      href={photo}
                      target="_blank"
                      rel="noreferrer"
                      className="overflow-hidden rounded-lg border border-[var(--site-border)]"
                    >
                      <img
                        src={photo}
                        alt={t("admin.reviews.photos", { count: index + 1 })}
                        className="size-16 object-cover"
                      />
                    </a>
                  ))}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[0.68rem] text-muted-foreground">
                  {t("admin.reviews.helpful", { count: formatNumber(review.helpfulCount, lang) })}
                </span>
                {canWrite ? (
                  <>
                    <button
                      type="button"
                      disabled={busyId === review.id || review.status === "approved"}
                      onClick={() => void act(review, { status: "approved" })}
                      className={cn(secondaryButtonClass, "h-8 px-3 text-xs")}
                    >
                      <Check aria-hidden="true" className="size-3.5" />
                      {t("admin.reviews.approve")}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === review.id || review.status === "rejected"}
                      onClick={() => void act(review, { status: "rejected" })}
                      className={cn(secondaryButtonClass, "h-8 px-3 text-xs")}
                    >
                      <X aria-hidden="true" className="size-3.5" />
                      {t("admin.reviews.reject")}
                    </button>
                  </>
                ) : null}
              </div>

              {canWrite ? (
                <div className="mt-3 border-t border-[var(--site-border)] pt-3">
                  <label className={labelClass} htmlFor={`reply-${review.id}`}>
                    {t("admin.reviews.reply")}
                  </label>
                  <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                    <input
                      id={`reply-${review.id}`}
                      value={replies[review.id] ?? ""}
                      onChange={(event) =>
                        setReplies((current) => ({ ...current, [review.id]: event.target.value }))
                      }
                      maxLength={600}
                      placeholder={t("admin.reviews.replyPlaceholder")}
                      className={cn(fieldClass, "h-9 text-sm")}
                    />
                    <button
                      type="button"
                      disabled={busyId === review.id || (replies[review.id] ?? "").trim().length === 0}
                      onClick={() => void act(review, { reply: (replies[review.id] ?? "").trim() })}
                      className={cn(primaryButtonClass, "h-9 shrink-0 px-4 text-xs")}
                    >
                      {t("admin.reviews.reply")}
                    </button>
                  </div>
                  {review.repliedAt ? (
                    <p className="mt-1.5 text-[0.65rem] text-muted-foreground">
                      {formatDateTime(review.repliedAt, lang)}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </AdminShell>
  );
}
