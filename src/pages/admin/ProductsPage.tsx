import {
  Archive,
  Download,
  ExternalLink,
  FileUp,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { toast } from "sonner";
import {
  FormAlert,
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import {
  adminErrorKey,
  archiveAdminProduct,
  csvTemplate,
  downloadText,
  importAdminProducts,
  loadAdminProducts,
  parseImportCsv,
  type AdminProduct,
} from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { useCatalog } from "../../lib/catalog";
import { formatNumber, formatTaka, useI18n, type DictKey } from "../../lib/i18n";
import { Link } from "../../lib/router";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AdminShell, Panel } from "./AdminShell";

const STATUS_FILTERS = ["", "active", "draft", "archived"] as const;

const STATUS_TONES: Record<AdminProduct["status"], string> = {
  active: "border-[color-mix(in_srgb,var(--site-accent)_55%,transparent)] text-[var(--accent-ink)]",
  draft: "border-[var(--site-border)] text-muted-foreground",
  archived: "border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] text-[var(--danger-ink)]",
};

function reasonKey(reason: string): DictKey {
  return `admin.products.reason.${reason}` as DictKey;
}

type ImportResult = {
  created: number;
  skipped: { line: number; reason: string }[];
  products: { id: string; slug: string; name: { bn: string; en: string }; status: string }[];
};

function ImportDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [publish, setPublish] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const parsed = useMemo(() => parseImportCsv(text), [text]);
  const tooMany = parsed.rows.length > 50;

  function reset() {
    setText("");
    setFileName("");
    setPublish(false);
    setResult(null);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setText(await file.text());
    setResult(null);
    event.target.value = "";
  }

  async function runImport() {
    if (parsed.rows.length === 0 || tooMany) {
      toast.error(t(tooMany ? "admin.products.importTooMany" : "admin.products.importEmpty"));
      return;
    }
    setRunning(true);
    try {
      const saved = await importAdminProducts(parsed.rows, publish);
      setResult(saved);
      toast.success(t("admin.products.importDone"));
      onDone();
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setRunning(false);
    }
  }

  const skipped = result
    ? result.skipped.map((entry) => ({
        line: parsed.lines[entry.line - 2] ?? entry.line,
        reason: entry.reason,
      }))
    : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        data-lenis-prevent
        className="max-h-[90vh] overflow-y-auto border-[var(--site-border)] bg-background sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{t("admin.products.importTitle")}</DialogTitle>
          <DialogDescription>{t("admin.products.importBody")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadText("lootpat-products.csv", csvTemplate())}
              className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}
            >
              <Download aria-hidden="true" className="size-3.5" />
              {t("admin.products.importTemplate")}
            </button>
            <label
              className={cn(
                secondaryButtonClass,
                "h-9 cursor-pointer px-3 text-xs",
                running && "pointer-events-none opacity-60",
              )}
            >
              <FileUp aria-hidden="true" className="size-3.5" />
              {t("admin.products.importUpload")}
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => void onFile(event)}
                disabled={running}
                className="sr-only"
              />
            </label>
            {fileName ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--site-border)] px-2.5 py-1 text-[0.68rem] text-muted-foreground">
                {fileName}
                <button
                  type="button"
                  onClick={() => {
                    setFileName("");
                    setText("");
                    setResult(null);
                  }}
                  aria-label={t("admin.clear")}
                  className="rounded-full text-muted-foreground transition hover:text-foreground"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </span>
            ) : null}
          </div>

          <div>
            <label htmlFor="import-csv" className={labelClass}>
              {t("admin.products.importOr")}
            </label>
            <textarea
              id="import-csv"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setResult(null);
              }}
              placeholder={t("admin.products.importPastePlaceholder")}
              disabled={running}
              spellCheck={false}
              className={cn(fieldClass, "mt-2 h-32 w-full resize-y py-2 font-mono text-[0.7rem] leading-relaxed")}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {t("admin.products.importHint")}
            </p>
          </div>

          {parsed.headerError ? <FormAlert message={t("admin.products.importHeaderError")} /> : null}
          {tooMany ? <FormAlert message={t("admin.products.importTooMany")} /> : null}

          {parsed.rows.length > 0 || parsed.errors.length > 0 ? (
            <div className="rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5 text-sm">
              <p className="font-medium text-foreground">{t("admin.products.importPreview")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("admin.products.importRows", { count: formatNumber(parsed.rows.length, lang) })}
                {parsed.errors.length > 0
                  ? ` · ${t("admin.products.importErrors", {
                      count: formatNumber(parsed.errors.length, lang),
                    })}`
                  : ""}
              </p>
              {parsed.errors.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {parsed.errors.slice(0, 6).map((entry) => (
                    <li key={`${entry.line}-${entry.reason}`} className="text-xs text-[var(--danger-ink)]">
                      {t("admin.products.importLine", { line: formatNumber(entry.line, lang) })} —{" "}
                      {t(reasonKey(entry.reason))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <div className="rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5 text-sm">
              <p className="font-medium text-foreground">{t("admin.products.importDone")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("admin.products.importResult", {
                  created: formatNumber(result.created, lang),
                  skipped: formatNumber(result.skipped.length, lang),
                })}
              </p>
              {skipped.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {skipped.slice(0, 8).map((entry) => (
                    <li key={`${entry.line}-${entry.reason}`} className="text-xs text-[var(--danger-ink)]">
                      {t("admin.products.importLine", { line: formatNumber(entry.line, lang) })} —{" "}
                      {t(reasonKey(entry.reason))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={publish}
              onChange={(event) => setPublish(event.target.checked)}
              disabled={running}
              className="size-4 rounded border-[var(--site-border)] accent-[var(--site-accent)]"
            />
            {t("admin.products.importPublish")}
          </label>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={secondaryButtonClass}
          >
            {t("admin.close")}
          </button>
          <button
            type="button"
            onClick={() => void runImport()}
            disabled={running || parsed.rows.length === 0 || tooMany}
            className={cn(primaryButtonClass, "h-10 w-auto px-4")}
          >
            <Upload aria-hidden="true" className="size-4" />
            {running ? t("admin.products.importing") : t("admin.products.importRun")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProductsPage() {
  const { t, lang } = useI18n();
  const { hasPermission } = useAuth();
  const { categories } = useCatalog();
  const canWrite = hasPermission("products.write");
  const canArchive = hasPermission("data.delete");

  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const result = await loadAdminProducts({
          q: debounced || undefined,
          status: status || undefined,
        });
        setProducts(result.products);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(t(adminErrorKey(cause)));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [debounced, status, t],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const categoryLabel = useCallback(
    (id: string) => categories.find((category) => category.id === id)?.name[lang] ?? id,
    [categories, lang],
  );

  async function archive(product: AdminProduct) {
    if (!canArchive) {
      toast.error(t("admin.products.archiveOwnerOnly"));
      return;
    }
    if (!window.confirm(t("admin.products.archiveConfirm", { name: product.name[lang] }))) {
      return;
    }
    setBusyId(product.id);
    try {
      await archiveAdminProduct(product.id);
      toast.success(t("admin.products.archived"));
      await load();
    } catch (cause) {
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminShell
      eyebrow={t("admin.products.eyebrow")}
      title={t("admin.products.title")}
      body={t("admin.products.body")}
      actions={
        <>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={secondaryButtonClass}
          >
            <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
            {t("admin.refresh")}
          </button>
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className={secondaryButtonClass}
          >
            <FileUp aria-hidden="true" className="size-4" />
            {t("admin.products.import")}
          </button>
          {canWrite ? (
            <Link to="/admin/products/new" className={cn(primaryButtonClass, "h-10 w-auto px-4")}>
              <Plus aria-hidden="true" className="size-4" />
              {t("admin.products.add")}
            </Link>
          ) : null}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("admin.products.searchPlaceholder")}
            aria-label={t("admin.search")}
            className={cn(fieldClass, "pl-9 pr-9")}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("admin.clear")}
              className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-[var(--surface-raised)] hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="product-status" className="sr-only">
            {t("admin.products.statusFilter")}
          </label>
          <select
            id="product-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as (typeof STATUS_FILTERS)[number])}
            className={cn(fieldClass, "h-11 w-auto min-w-36")}
          >
            {STATUS_FILTERS.map((value) => (
              <option key={value || "all"} value={value}>
                {value === "" ? t("admin.all") : t(`admin.products.status.${value}` as DictKey)}
              </option>
            ))}
          </select>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("admin.products.count", { count: formatNumber(products.length, lang) })}
        </p>
      </div>

      {error ? (
        <div className="mt-4 space-y-3">
          <FormAlert message={error} />
          <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("admin.tryAgain")}
          </button>
        </div>
      ) : null}

      {loading && products.length === 0 ? (
        <div className="mt-5 space-y-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((row) => (
            <div key={row} className="h-16 animate-pulse rounded-xl bg-[var(--surface-sunken)]" />
          ))}
        </div>
      ) : null}

      {!loading && products.length === 0 && !error ? (
        <Panel className="mt-5 text-sm text-muted-foreground">
          <p>{t("admin.products.empty")}</p>
          <p className="mt-1">{t("admin.products.emptyBody")}</p>
        </Panel>
      ) : null}

      {products.length > 0 ? (
        <div className="mt-5 overflow-hidden rounded-2xl border border-[var(--site-border)]">
          <div className="hidden grid-cols-[minmax(0,2.4fr)_0.9fr_0.8fr_0.7fr_0.8fr_1.1fr] gap-3 border-b border-[var(--site-border)] bg-[var(--surface-sunken)] px-4 py-2.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
            <span>{t("admin.products.name")}</span>
            <span className="text-right">{t("admin.products.price")}</span>
            <span className="text-right">{t("admin.products.stock")}</span>
            <span className="text-right">{t("admin.products.variants")}</span>
            <span>{t("admin.products.statusFilter")}</span>
            <span className="text-right">{t("admin.products.actions")}</span>
          </div>

          <ul className="divide-y divide-[var(--site-border)]">
            {products.map((product) => {
              const busy = busyId === product.id;
              const low = product.stock <= product.lowStockThreshold;
              return (
                <li
                  key={product.id}
                  className="grid gap-3 bg-[color-mix(in_srgb,var(--surface-raised)_60%,transparent)] px-4 py-3 lg:grid-cols-[minmax(0,2.4fr)_0.9fr_0.8fr_0.7fr_0.8fr_1.1fr] lg:items-center"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <img
                      src={product.imageSmall || product.image}
                      alt=""
                      loading="lazy"
                      className="size-11 shrink-0 rounded-lg border border-[var(--site-border)] object-cover"
                    />
                    <div className="min-w-0">
                      <Link
                        to={`/product/${product.slug}`}
                        className="block truncate text-sm font-medium text-foreground hover:text-[var(--accent-ink)]"
                      >
                        {product.name[lang]}
                      </Link>
                      <p className="truncate text-[0.68rem] text-muted-foreground">
                        {categoryLabel(product.categoryId)} · {product.slug}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                    <span className="text-[0.62rem] uppercase tracking-wide text-muted-foreground lg:hidden">
                      {t("admin.products.price")}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {formatTaka(product.pricePaisa / 100, lang)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                    <span className="text-[0.62rem] uppercase tracking-wide text-muted-foreground lg:hidden">
                      {t("admin.products.stock")}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 text-sm tabular-nums",
                        low ? "font-semibold text-[var(--brand-gold)]" : "text-foreground",
                      )}
                    >
                      {formatNumber(product.stock, lang)}
                      {low ? (
                        <span className="rounded-full border border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] px-1.5 py-0.5 text-[0.58rem] font-semibold">
                          {t("admin.products.low")}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 lg:block lg:text-right">
                    <span className="text-[0.62rem] uppercase tracking-wide text-muted-foreground lg:hidden">
                      {t("admin.products.variants")}
                    </span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {t("admin.products.variantCount", {
                        count: formatNumber(product.variants.length, lang),
                      })}
                    </span>
                  </div>

                  <div>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold",
                        STATUS_TONES[product.status],
                      )}
                    >
                      {t(`admin.products.status.${product.status}` as DictKey)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                    {canWrite ? (
                      <Link
                        to={`/admin/products/${product.id}/edit`}
                        className={cn(secondaryButtonClass, "h-8 gap-1.5 px-2.5 text-[0.7rem]")}
                      >
                        <Pencil aria-hidden="true" className="size-3.5" />
                        {t("admin.products.edit")}
                      </Link>
                    ) : null}
                    <Link
                      to={`/product/${product.slug}`}
                      className={cn(secondaryButtonClass, "h-8 gap-1.5 px-2.5 text-[0.7rem]")}
                    >
                      <ExternalLink aria-hidden="true" className="size-3.5" />
                      {t("admin.products.view")}
                    </Link>
                    {canArchive && product.status !== "archived" ? (
                      <button
                        type="button"
                        onClick={() => void archive(product)}
                        disabled={busy}
                        className={cn(secondaryButtonClass, "h-8 gap-1.5 px-2.5 text-[0.7rem]")}
                      >
                        <Archive aria-hidden="true" className="size-3.5" />
                        {t("admin.products.archive")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onDone={() => void load()}
      />
    </AdminShell>
  );
}
