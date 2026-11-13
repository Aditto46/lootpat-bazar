import {
  ArrowLeft,
  ArrowRight,
  Check,
  Image as ImageIcon,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FormAlert,
  PageLoading,
  fieldClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import {
  adminErrorKey,
  createAdminProduct,
  loadAdminProduct,
  updateAdminProduct,
  type AdminProduct,
  type AdminProductInput,
} from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { useCatalog, type ProductBadge } from "../../lib/catalog";
import { formatNumber, formatTaka, useI18n, type DictKey } from "../../lib/i18n";
import { Link, useRouter } from "../../lib/router";
import { cn } from "@/lib/utils";
import { AdminShell, Panel } from "./AdminShell";

const STEPS: { title: DictKey; body: DictKey; short: DictKey }[] = [
  { title: "admin.wizard.step1", body: "admin.wizard.step1Body", short: "admin.wizard.step1Short" },
  { title: "admin.wizard.step2", body: "admin.wizard.step2Body", short: "admin.wizard.step2Short" },
  { title: "admin.wizard.step3", body: "admin.wizard.step3Body", short: "admin.wizard.step3Short" },
  { title: "admin.wizard.step4", body: "admin.wizard.step4Body", short: "admin.wizard.step4Short" },
];

const BADGES: ProductBadge[] = ["bestseller", "new", "limited"];

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_PATTERN = /^(?:\/(?!\/)[^\s<>"'\\]+|https:\/\/[^\s<>"'\\]+)$/;
const SWATCH_PATTERN = /^#[0-9a-fA-F]{6}$/;

type VariantForm = {
  id?: string;
  key: string;
  optionType: "color" | "size";
  labelEn: string;
  labelBn: string;
  price: string;
  stock: string;
  sku: string;
  swatch: string;
};

type FormState = {
  nameBn: string;
  nameEn: string;
  slug: string;
  categoryId: string;
  brand: string;
  taglineBn: string;
  taglineEn: string;
  descriptionBn: string;
  descriptionEn: string;
  price: string;
  compareAt: string;
  stock: string;
  lowStockThreshold: string;
  badge: "" | ProductBadge;
  featured: boolean;
  image: string;
  imageSmall: string;
  withVariants: boolean;
  variants: VariantForm[];
};

const emptyForm: FormState = {
  nameBn: "",
  nameEn: "",
  slug: "",
  categoryId: "",
  brand: "LootPat Bazar",
  taglineBn: "",
  taglineEn: "",
  descriptionBn: "",
  descriptionEn: "",
  price: "",
  compareAt: "",
  stock: "0",
  lowStockThreshold: "5",
  badge: "",
  featured: false,
  image: "",
  imageSmall: "",
  withVariants: false,
  variants: [],
};

function takaString(paisa: number): string {
  return String(paisa / 100);
}

function takaToPaisa(value: string): number | null {
  const cleaned = value.replace(/[,\s৳]/g, "");
  if (!cleaned) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function wholeNumber(value: string): number | null {
  const cleaned = value.trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isSafeInteger(amount) ? amount : null;
}

function fromProduct(product: AdminProduct): FormState {
  return {
    nameBn: product.name.bn,
    nameEn: product.name.en,
    slug: product.slug,
    categoryId: product.categoryId,
    brand: product.brand ?? "LootPat Bazar",
    taglineBn: product.tagline.bn,
    taglineEn: product.tagline.en,
    descriptionBn: product.description.bn,
    descriptionEn: product.description.en,
    price: takaString(product.pricePaisa),
    compareAt: product.compareAtPaisa ? takaString(product.compareAtPaisa) : "",
    stock: String(product.stock),
    lowStockThreshold: String(product.lowStockThreshold),
    badge: product.badge ?? "",
    featured: product.featured,
    image: product.image,
    imageSmall: product.imageSmall,
    withVariants: product.variants.length > 0,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      key: variant.id,
      optionType: variant.optionType,
      labelEn: variant.label.en,
      labelBn: variant.label.bn,
      price: takaString(variant.pricePaisa),
      stock: String(variant.stock),
      sku: variant.sku,
      swatch: variant.swatch ?? "",
    })),
  };
}

function newVariant(price: string, optionType: "color" | "size"): VariantForm {
  return {
    key: crypto.randomUUID(),
    optionType,
    labelEn: "",
    labelBn: "",
    price,
    stock: "10",
    sku: "",
    swatch: "",
  };
}

export function ProductWizard({ productId }: { productId?: string }) {
  const { t, lang } = useI18n();
  const { hasPermission } = useAuth();
  const { navigate } = useRouter();
  const { categories, products } = useCatalog();
  const canWrite = hasPermission("products.write");

  const [form, setForm] = useState<FormState>(emptyForm);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [stepError, setStepError] = useState<DictKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(Boolean(productId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedVariants, setSavedVariants] = useState(false);

  useEffect(() => {
    if (!productId) {
      setLoadingProduct(false);
      return;
    }
    const controller = new AbortController();
    setLoadingProduct(true);
    loadAdminProduct(productId)
      .then(({ product }) => {
        if (controller.signal.aborted) return;
        setForm(fromProduct(product));
        setSavedVariants(product.variants.length > 0);
        setLoadError(null);
        setStep(0);
        setMaxStep(0);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoadError(t(adminErrorKey(cause)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProduct(false);
      });
    return () => controller.abort();
  }, [productId, t]);

  const imageLibrary = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const product of products) {
      for (const image of [product.image, product.imageSmall]) {
        if (image && !seen.has(image)) {
          seen.add(image);
          list.push(image);
        }
      }
    }
    return list.slice(0, 18);
  }, [products]);

  const categoryLabel = useCallback(
    (id: string) => categories.find((category) => category.id === id)?.name[lang] ?? id,
    [categories, lang],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateVariant(index: number, patch: Partial<VariantForm>) {
    setForm((current) => ({
      ...current,
      variants: current.variants.map((variant, position) =>
        position === index ? { ...variant, ...patch } : variant,
      ),
    }));
  }

  function stepIssue(index: number): DictKey | null {
    if (index === 0) {
      if (form.nameBn.trim().length < 2 || form.nameEn.trim().length < 2) {
        return "admin.wizard.errorName";
      }
      if (!form.categoryId) return "admin.wizard.errorCategory";
      if (form.slug.trim() && !SLUG_PATTERN.test(form.slug.trim())) {
        return "admin.wizard.errorSlugFormat";
      }
      return null;
    }

    if (index === 1) {
      if (!form.withVariants) return null;
      if (form.variants.length === 0) return "admin.wizard.errorVariantEmpty";
      for (const variant of form.variants) {
        if (!variant.labelEn.trim() || !variant.labelBn.trim()) {
          return "admin.wizard.errorVariantLabel";
        }
        const price = takaToPaisa(variant.price);
        if (price === null || price < 100) return "admin.wizard.errorVariantPrice";
        if (wholeNumber(variant.stock) === null) return "admin.wizard.errorStock";
        if (variant.swatch.trim() && !SWATCH_PATTERN.test(variant.swatch.trim())) {
          return "admin.wizard.errorSwatch";
        }
      }
      return null;
    }

    const price = takaToPaisa(form.price);
    if (price === null || price < 100) return "admin.wizard.errorPrice";
    if (form.compareAt.trim()) {
      const compare = takaToPaisa(form.compareAt);
      if (compare === null) return "admin.wizard.errorPrice";
      if (compare < price) return "admin.wizard.errorCompare";
    }
    if (!IMAGE_PATTERN.test(form.image.trim())) return "admin.wizard.errorImage";
    if (form.imageSmall.trim() && !IMAGE_PATTERN.test(form.imageSmall.trim())) {
      return "admin.wizard.errorImage";
    }
    if (!form.withVariants && wholeNumber(form.stock) === null) {
      return "admin.wizard.errorStock";
    }
    if (wholeNumber(form.lowStockThreshold) === null) return "admin.wizard.errorStock";
    return null;
  }

  function goNext() {
    const issue = stepIssue(step);
    if (issue) {
      setStepError(issue);
      return;
    }
    setStepError(null);
    const next = Math.min(STEPS.length - 1, step + 1);
    setStep(next);
    setMaxStep((current) => Math.max(current, next));
  }

  function goTo(index: number) {
    if (index > maxStep || index === step) return;
    setStepError(null);
    setStep(index);
  }

  function buildInput(target: "draft" | "active"): AdminProductInput {
    const input: AdminProductInput = {
      nameBn: form.nameBn.trim(),
      nameEn: form.nameEn.trim(),
      slug: form.slug.trim() || undefined,
      categoryId: form.categoryId,
      brand: form.brand.trim() || "LootPat Bazar",
      taglineBn: form.taglineBn.trim(),
      taglineEn: form.taglineEn.trim(),
      descriptionBn: form.descriptionBn.trim(),
      descriptionEn: form.descriptionEn.trim(),
      pricePaisa: takaToPaisa(form.price) ?? 0,
      compareAtPaisa: form.compareAt.trim() ? takaToPaisa(form.compareAt) : null,
      lowStockThreshold: wholeNumber(form.lowStockThreshold) ?? 5,
      badge: form.badge || null,
      image: form.image.trim(),
      imageSmall: form.imageSmall.trim() || undefined,
      featured: form.featured,
      status: target,
      variants: form.withVariants
        ? form.variants.map((variant, index) => ({
            ...(variant.id ? { id: variant.id } : {}),
            ...(variant.sku.trim() ? { sku: variant.sku.trim() } : {}),
            optionType: variant.optionType,
            labelEn: variant.labelEn.trim(),
            labelBn: variant.labelBn.trim(),
            pricePaisa: takaToPaisa(variant.price) ?? 0,
            stock: wholeNumber(variant.stock) ?? 0,
            ...(variant.swatch.trim() ? { swatch: variant.swatch.trim() } : {}),
            position: index,
          }))
        : [],
    };
    if (!form.withVariants) input.stock = wholeNumber(form.stock) ?? 0;
    return input;
  }

  async function save(target: "draft" | "active") {
    for (const index of [0, 1, 2]) {
      const issue = stepIssue(index);
      if (issue) {
        setStep(index);
        setMaxStep((current) => Math.max(current, index));
        setStepError(issue);
        return;
      }
    }

    setSaving(true);
    setStepError(null);
    try {
      if (productId) {
        await updateAdminProduct(productId, buildInput(target));
      } else {
        await createAdminProduct(buildInput(target));
      }
      toast.success(
        t(target === "active" ? "admin.wizard.savedPublished" : "admin.wizard.savedDraft"),
      );
      navigate("/admin/products");
    } catch (cause) {
      setStepError(adminErrorKey(cause));
      toast.error(t(adminErrorKey(cause)));
    } finally {
      setSaving(false);
    }
  }

  const shellProps = {
    eyebrow: t("admin.wizard.eyebrow"),
    title: t(productId ? "admin.wizard.editTitle" : "admin.wizard.newTitle"),
    body: t("admin.wizard.body"),
  };

  if (!canWrite) {
    return (
      <AdminShell {...shellProps}>
        <Panel className="text-sm text-muted-foreground">{t("admin.notAllowed")}</Panel>
      </AdminShell>
    );
  }

  if (loadingProduct) {
    return (
      <AdminShell {...shellProps}>
        <PageLoading label={t("admin.wizard.loading")} />
      </AdminShell>
    );
  }

  if (loadError) {
    return (
      <AdminShell {...shellProps}>
        <div className="max-w-md space-y-3">
          <FormAlert message={loadError} />
          <Link to="/admin/products" className={secondaryButtonClass}>
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("admin.products.title")}
          </Link>
        </div>
      </AdminShell>
    );
  }

  const pricePaisa = takaToPaisa(form.price);
  const comparePaisa = form.compareAt.trim() ? takaToPaisa(form.compareAt) : null;
  const variantTotal = form.variants.reduce(
    (total, variant) => total + (wholeNumber(variant.stock) ?? 0),
    0,
  );

  return (
    <AdminShell
      {...shellProps}
      actions={
        <Link to="/admin/products" className={secondaryButtonClass}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("admin.products.title")}
        </Link>
      }
    >
      <ol className="grid gap-2 sm:grid-cols-4">
        {STEPS.map((item, index) => {
          const done = index < step && index <= maxStep;
          const active = index === step;
          const reachable = index <= maxStep;
          return (
            <li key={item.short}>
              <button
                type="button"
                onClick={() => goTo(index)}
                disabled={!reachable}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition",
                  active
                    ? "border-[var(--site-accent)] bg-[color-mix(in_srgb,var(--site-accent)_12%,transparent)] text-foreground"
                    : done
                      ? "border-[var(--site-border)] text-foreground"
                      : "border-[var(--site-border)] text-muted-foreground",
                  reachable ? "hover:border-[var(--accent-ink)]" : "cursor-default",
                )}
              >
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border text-[0.65rem]",
                    active || done
                      ? "border-[var(--site-accent)] text-[var(--accent-ink)]"
                      : "border-[var(--site-border)]",
                  )}
                >
                  {done ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
                </span>
                <span className="truncate">{t(item.short)}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-5 grid items-start gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Panel aria-labelledby="wizard-step-heading">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--accent-ink)]">
            {t("admin.wizard.step", {
              current: formatNumber(step + 1, lang),
              total: formatNumber(STEPS.length, lang),
            })}
          </p>
          <h2 id="wizard-step-heading" className="mt-1.5 text-lg font-semibold text-foreground">
            {t(STEPS[step].title)}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(STEPS[step].body)}</p>

          {step === 0 ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="wizard-name-bn" className={labelClass}>
                    {t("admin.wizard.nameBn")}
                  </label>
                  <input
                    id="wizard-name-bn"
                    type="text"
                    value={form.nameBn}
                    maxLength={80}
                    onChange={(event) => set("nameBn", event.target.value)}
                    disabled={saving}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="wizard-name-en" className={labelClass}>
                    {t("admin.wizard.nameEn")}
                  </label>
                  <input
                    id="wizard-name-en"
                    type="text"
                    value={form.nameEn}
                    maxLength={80}
                    onChange={(event) => set("nameEn", event.target.value)}
                    disabled={saving}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="wizard-category" className={labelClass}>
                    {t("admin.wizard.category")}
                  </label>
                  <select
                    id="wizard-category"
                    value={form.categoryId}
                    onChange={(event) => set("categoryId", event.target.value)}
                    disabled={saving}
                    className={fieldClass}
                  >
                    <option value="">{t("admin.wizard.categoryPlaceholder")}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name[lang]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="wizard-brand" className={labelClass}>
                    {t("admin.wizard.brand")}
                  </label>
                  <input
                    id="wizard-brand"
                    type="text"
                    value={form.brand}
                    maxLength={40}
                    onChange={(event) => set("brand", event.target.value)}
                    disabled={saving}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="wizard-slug" className={labelClass}>
                  {t("admin.wizard.slug")} · {t("admin.wizard.optional")}
                </label>
                <input
                  id="wizard-slug"
                  type="text"
                  value={form.slug}
                  maxLength={80}
                  dir="ltr"
                  onChange={(event) => set("slug", event.target.value)}
                  disabled={saving}
                  aria-describedby="wizard-slug-hint"
                  className={fieldClass}
                />
                <p id="wizard-slug-hint" className="text-xs text-muted-foreground">
                  {t("admin.wizard.slugHint")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="wizard-tagline-bn" className={labelClass}>
                    {t("admin.wizard.taglineBn")}
                  </label>
                  <input
                    id="wizard-tagline-bn"
                    type="text"
                    value={form.taglineBn}
                    maxLength={160}
                    onChange={(event) => set("taglineBn", event.target.value)}
                    disabled={saving}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="wizard-tagline-en" className={labelClass}>
                    {t("admin.wizard.taglineEn")}
                  </label>
                  <input
                    id="wizard-tagline-en"
                    type="text"
                    value={form.taglineEn}
                    maxLength={160}
                    onChange={(event) => set("taglineEn", event.target.value)}
                    disabled={saving}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="wizard-description-bn" className={labelClass}>
                    {t("admin.wizard.descriptionBn")}
                  </label>
                  <textarea
                    id="wizard-description-bn"
                    value={form.descriptionBn}
                    maxLength={2000}
                    rows={4}
                    onChange={(event) => set("descriptionBn", event.target.value)}
                    disabled={saving}
                    className={cn(fieldClass, "h-auto py-2")}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="wizard-description-en" className={labelClass}>
                    {t("admin.wizard.descriptionEn")}
                  </label>
                  <textarea
                    id="wizard-description-en"
                    value={form.descriptionEn}
                    maxLength={2000}
                    rows={4}
                    onChange={(event) => set("descriptionEn", event.target.value)}
                    disabled={saving}
                    className={cn(fieldClass, "h-auto py-2")}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="mt-5 space-y-4">
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5">
                <input
                  type="checkbox"
                  checked={form.withVariants}
                  disabled={saving || savedVariants}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setForm((current) => ({
                      ...current,
                      withVariants: checked,
                      variants: checked
                        ? current.variants.length > 0
                          ? current.variants
                          : [newVariant(current.price, "color")]
                        : current.variants,
                    }));
                  }}
                  className="mt-0.5 size-4 rounded border-[var(--site-border)] accent-[var(--site-accent)]"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">
                    {t("admin.wizard.withVariants")}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {t("admin.wizard.variantsNote")}
                  </span>
                </span>
              </label>

              {!form.withVariants ? (
                <p className="text-sm text-muted-foreground">{t("admin.wizard.noVariants")}</p>
              ) : (
                <div className="space-y-3">
                  {form.variants.map((variant, index) => (
                    <div
                      key={variant.key}
                      className="rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t("admin.wizard.variantN", { n: formatNumber(index + 1, lang) })}
                        </p>
                        {variant.id ? (
                          <span className="text-[0.62rem] text-muted-foreground">
                            {t("admin.wizard.variantLocked")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() =>
                              setForm((current) => ({
                                ...current,
                                variants: current.variants.filter((_, position) => position !== index),
                              }))
                            }
                            className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-[var(--danger-ink)] transition hover:underline disabled:opacity-60"
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                            {t("admin.wizard.removeVariant")}
                          </button>
                        )}
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <label htmlFor={`variant-${variant.key}-type`} className="text-xs font-medium text-foreground">
                            {t("admin.wizard.optionType")}
                          </label>
                          <select
                            id={`variant-${variant.key}-type`}
                            value={variant.optionType}
                            disabled={saving}
                            onChange={(event) =>
                              updateVariant(index, {
                                optionType: event.target.value as "color" | "size",
                              })
                            }
                            className={cn(fieldClass, "h-10 text-sm")}
                          >
                            <option value="color">{t("admin.wizard.optionColor")}</option>
                            <option value="size">{t("admin.wizard.optionSize")}</option>
                          </select>
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor={`variant-${variant.key}-sku`} className="text-xs font-medium text-foreground">
                            {t("admin.wizard.sku")}
                          </label>
                          <input
                            id={`variant-${variant.key}-sku`}
                            type="text"
                            value={variant.sku}
                            maxLength={40}
                            dir="ltr"
                            disabled={saving}
                            placeholder={t("admin.wizard.skuHint")}
                            onChange={(event) => updateVariant(index, { sku: event.target.value })}
                            className={cn(fieldClass, "h-10 text-sm")}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor={`variant-${variant.key}-label-bn`} className="text-xs font-medium text-foreground">
                            {t("admin.wizard.labelBn")}
                          </label>
                          <input
                            id={`variant-${variant.key}-label-bn`}
                            type="text"
                            value={variant.labelBn}
                            maxLength={40}
                            disabled={saving}
                            onChange={(event) => updateVariant(index, { labelBn: event.target.value })}
                            className={cn(fieldClass, "h-10 text-sm")}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor={`variant-${variant.key}-label-en`} className="text-xs font-medium text-foreground">
                            {t("admin.wizard.labelEn")}
                          </label>
                          <input
                            id={`variant-${variant.key}-label-en`}
                            type="text"
                            value={variant.labelEn}
                            maxLength={40}
                            disabled={saving}
                            onChange={(event) => updateVariant(index, { labelEn: event.target.value })}
                            className={cn(fieldClass, "h-10 text-sm")}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor={`variant-${variant.key}-price`} className="text-xs font-medium text-foreground">
                            {t("admin.wizard.variantPrice")}
                          </label>
                          <input
                            id={`variant-${variant.key}-price`}
                            type="text"
                            inputMode="decimal"
                            value={variant.price}
                            disabled={saving}
                            onChange={(event) => updateVariant(index, { price: event.target.value })}
                            className={cn(fieldClass, "h-10 text-sm")}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label htmlFor={`variant-${variant.key}-stock`} className="text-xs font-medium text-foreground">
                            {t("admin.wizard.variantStock")}
                          </label>
                          <input
                            id={`variant-${variant.key}-stock`}
                            type="text"
                            inputMode="numeric"
                            value={variant.stock}
                            disabled={saving}
                            onChange={(event) => updateVariant(index, { stock: event.target.value })}
                            className={cn(fieldClass, "h-10 text-sm")}
                          />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                          <label htmlFor={`variant-${variant.key}-swatch`} className="text-xs font-medium text-foreground">
                            {t("admin.wizard.swatch")} · {t("admin.wizard.optional")}
                          </label>
                          <div className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="size-8 shrink-0 rounded-lg border border-[var(--site-border)]"
                              style={{
                                backgroundColor: SWATCH_PATTERN.test(variant.swatch.trim())
                                  ? variant.swatch.trim()
                                  : "transparent",
                              }}
                            />
                            <input
                              id={`variant-${variant.key}-swatch`}
                              type="text"
                              value={variant.swatch}
                              maxLength={7}
                              dir="ltr"
                              placeholder="#14151B"
                              disabled={saving}
                              onChange={(event) => updateVariant(index, { swatch: event.target.value })}
                              className={cn(fieldClass, "h-10 text-sm")}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  <button
                    type="button"
                    disabled={saving || form.variants.length >= 10}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        variants: [...current.variants, newVariant(current.price, "color")],
                      }))
                    }
                    className={cn(secondaryButtonClass, "h-9 text-xs")}
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    {t("admin.wizard.addVariant")}
                  </button>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("admin.products.deleteNote")}
                  </p>
                </div>
              )}
            </div>
          ) : null}

          {step === 2 ? (
            <div className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="wizard-price" className={labelClass}>
                    {t("admin.wizard.price")}
                  </label>
                  <input
                    id="wizard-price"
                    type="text"
                    inputMode="decimal"
                    value={form.price}
                    disabled={saving}
                    onChange={(event) => set("price", event.target.value)}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="wizard-compare" className={labelClass}>
                    {t("admin.wizard.compareAt")} · {t("admin.wizard.optional")}
                  </label>
                  <input
                    id="wizard-compare"
                    type="text"
                    inputMode="decimal"
                    value={form.compareAt}
                    disabled={saving}
                    onChange={(event) => set("compareAt", event.target.value)}
                    aria-describedby="wizard-compare-hint"
                    className={fieldClass}
                  />
                  <p id="wizard-compare-hint" className="text-xs text-muted-foreground">
                    {t("admin.wizard.compareHint")}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {!form.withVariants ? (
                  <div className="space-y-2">
                    <label htmlFor="wizard-stock" className={labelClass}>
                      {t("admin.wizard.stock")}
                    </label>
                    <input
                      id="wizard-stock"
                      type="text"
                      inputMode="numeric"
                      value={form.stock}
                      disabled={saving}
                      onChange={(event) => set("stock", event.target.value)}
                      className={fieldClass}
                    />
                  </div>
                ) : (
                  <p className="self-end rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3.5 py-2.5 text-xs text-muted-foreground">
                    {t("admin.wizard.totalStock", { count: formatNumber(variantTotal, lang) })}
                  </p>
                )}
                <div className="space-y-2">
                  <label htmlFor="wizard-low-stock" className={labelClass}>
                    {t("admin.wizard.lowStock")}
                  </label>
                  <input
                    id="wizard-low-stock"
                    type="text"
                    inputMode="numeric"
                    value={form.lowStockThreshold}
                    disabled={saving}
                    onChange={(event) => set("lowStockThreshold", event.target.value)}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="wizard-image" className={labelClass}>
                  {t("admin.wizard.image")}
                </label>
                <input
                  id="wizard-image"
                  type="text"
                  value={form.image}
                  maxLength={300}
                  dir="ltr"
                  disabled={saving}
                  onChange={(event) => set("image", event.target.value)}
                  aria-describedby="wizard-image-hint"
                  className={fieldClass}
                />
                <p id="wizard-image-hint" className="text-xs text-muted-foreground">
                  {t("admin.wizard.imageHint")}
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="wizard-image-small" className={labelClass}>
                  {t("admin.wizard.imageSmall")}
                </label>
                <input
                  id="wizard-image-small"
                  type="text"
                  value={form.imageSmall}
                  maxLength={300}
                  dir="ltr"
                  disabled={saving}
                  onChange={(event) => set("imageSmall", event.target.value)}
                  className={fieldClass}
                />
              </div>

              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t("admin.wizard.imageLibrary")}
                </p>
                <div className="scrollbar-thin mt-2 flex gap-2 overflow-x-auto pb-1">
                  {imageLibrary.map((image) => (
                    <button
                      key={image}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        set("image", image);
                        if (!form.imageSmall.trim()) set("imageSmall", image);
                      }}
                      aria-pressed={form.image === image}
                      className={cn(
                        "size-14 shrink-0 overflow-hidden rounded-lg border transition",
                        form.image === image
                          ? "border-[var(--site-accent)] ring-2 ring-[color-mix(in_srgb,var(--site-accent)_32%,transparent)]"
                          : "border-[var(--site-border)] hover:border-[var(--accent-ink)]",
                      )}
                    >
                      <img
                        src={image}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                        onError={(event) => {
                          event.currentTarget.src = "/products/placeholder.svg";
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="wizard-badge" className={labelClass}>
                    {t("admin.wizard.badge")}
                  </label>
                  <select
                    id="wizard-badge"
                    value={form.badge}
                    disabled={saving}
                    onChange={(event) => set("badge", event.target.value as "" | ProductBadge)}
                    className={fieldClass}
                  >
                    <option value="">{t("admin.wizard.noBadge")}</option>
                    {BADGES.map((badge) => (
                      <option key={badge} value={badge}>
                        {t(`admin.wizard.badge.${badge}` as DictKey)}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 self-end rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5">
                  <input
                    type="checkbox"
                    checked={form.featured}
                    disabled={saving}
                    onChange={(event) => set("featured", event.target.checked)}
                    className="mt-0.5 size-4 rounded border-[var(--site-border)] accent-[var(--site-accent)]"
                  />
                  <span className="text-sm font-medium text-foreground">
                    {t("admin.wizard.featured")}
                  </span>
                </label>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="mt-5 space-y-5 text-sm">
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("admin.wizard.reviewBasic")}
                </h3>
                <dl className="mt-2 grid gap-2 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5 sm:grid-cols-2">
                  <div>
                    <dt className="text-[0.62rem] uppercase tracking-wide text-muted-foreground">
                      {t("admin.wizard.nameBn")}
                    </dt>
                    <dd className="mt-0.5 font-medium text-foreground">{form.nameBn || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.62rem] uppercase tracking-wide text-muted-foreground">
                      {t("admin.wizard.nameEn")}
                    </dt>
                    <dd className="mt-0.5 font-medium text-foreground">{form.nameEn || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.62rem] uppercase tracking-wide text-muted-foreground">
                      {t("admin.wizard.category")}
                    </dt>
                    <dd className="mt-0.5 text-foreground">
                      {form.categoryId ? categoryLabel(form.categoryId) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.62rem] uppercase tracking-wide text-muted-foreground">
                      {t("admin.wizard.slug")}
                    </dt>
                    <dd className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {form.slug.trim() || t("admin.wizard.slugHint")}
                    </dd>
                  </div>
                </dl>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("admin.wizard.reviewVariants")}
                </h3>
                {form.withVariants ? (
                  <ul className="mt-2 divide-y divide-[var(--site-border)] rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)]">
                    {form.variants.map((variant) => (
                      <li key={variant.key} className="flex flex-wrap items-center gap-2 p-3">
                        <span className="min-w-0 flex-1 truncate text-foreground">
                          {variant.labelBn || "—"} · {variant.labelEn || "—"}
                        </span>
                        <span className="font-mono text-[0.65rem] text-muted-foreground">
                          {variant.sku.trim() || "SKU"}
                        </span>
                        <span className="text-xs tabular-nums text-foreground">
                          {formatTaka((takaToPaisa(variant.price) ?? 0) / 100, lang)}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          ×{wholeNumber(variant.stock) ?? 0}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">{t("admin.wizard.noVariantsReview")}</p>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("admin.wizard.reviewMedia")}
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-4 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5">
                  {form.image.trim() ? (
                    <img
                      src={form.image.trim()}
                      alt={t("admin.wizard.imagePreview")}
                      className="size-16 rounded-lg border border-[var(--site-border)] object-cover"
                      onError={(event) => {
                        event.currentTarget.src = "/products/placeholder.svg";
                      }}
                    />
                  ) : (
                    <span className="grid size-16 place-items-center rounded-lg border border-dashed border-[var(--site-border)] text-muted-foreground">
                      <ImageIcon aria-hidden="true" className="size-5" />
                    </span>
                  )}
                  <dl className="min-w-0 flex-1 space-y-1 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("admin.wizard.price")}</dt>
                      <dd className="font-semibold tabular-nums text-foreground">
                        {pricePaisa === null ? "—" : formatTaka(pricePaisa / 100, lang)}
                      </dd>
                    </div>
                    {comparePaisa !== null ? (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{t("admin.wizard.compareAt")}</dt>
                        <dd className="tabular-nums text-muted-foreground">
                          {formatTaka(comparePaisa / 100, lang)}
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("admin.products.badgeLabel")}</dt>
                      <dd className="text-foreground">
                        {form.badge ? t(`admin.wizard.badge.${form.badge}` as DictKey) : t("admin.wizard.noBadge")}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("admin.wizard.featured")}</dt>
                      <dd className="text-foreground">{form.featured ? "✓" : "—"}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("admin.products.stock")}</dt>
                      <dd className="tabular-nums text-foreground">
                        {form.withVariants ? variantTotal : wholeNumber(form.stock) ?? 0}
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>

              <p className="rounded-xl border border-[var(--site-border)] bg-[color-mix(in_srgb,var(--site-accent)_7%,transparent)] px-3.5 py-2.5 text-xs leading-relaxed text-muted-foreground">
                {t("admin.wizard.reviewHint")}
              </p>
            </div>
          ) : null}

          {stepError ? (
            <div className="mt-4">
              <FormAlert message={t(stepError)} />
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--site-border)] pt-4">
            <button
              type="button"
              onClick={() => goTo(Math.max(0, step - 1))}
              disabled={step === 0 || saving}
              className={secondaryButtonClass}
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {t("admin.wizard.back")}
            </button>

            {step < STEPS.length - 1 ? (
              <button type="button" onClick={goNext} disabled={saving} className={cn(primaryButtonClass, "w-auto px-5")}>
                {t("admin.wizard.next")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </button>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void save("draft")}
                  disabled={saving}
                  className={secondaryButtonClass}
                >
                  <Save aria-hidden="true" className="size-4" />
                  {saving ? t("admin.wizard.saving") : t("admin.wizard.saveDraft")}
                </button>
                <button
                  type="button"
                  onClick={() => void save("active")}
                  disabled={saving}
                  className={cn(primaryButtonClass, "w-auto px-5")}
                >
                  <Check aria-hidden="true" className="size-4" />
                  {saving ? t("admin.wizard.saving") : t("admin.wizard.publish")}
                </button>
              </div>
            )}
          </div>
        </Panel>

        <aside className="glass sticky top-28 hidden rounded-[var(--radius-card)] p-5 xl:block">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("admin.wizard.eyebrow")}
          </p>
          <ol className="mt-3 space-y-3">
            {STEPS.map((item, index) => (
              <li key={item.short} className="flex gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[0.6rem]",
                    index === step
                      ? "border-[var(--site-accent)] text-[var(--accent-ink)]"
                      : "border-[var(--site-border)] text-muted-foreground",
                  )}
                >
                  {index < step ? <Check aria-hidden="true" className="size-3" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "text-xs leading-relaxed",
                    index === step ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t(item.title)}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[0.68rem] leading-relaxed text-muted-foreground">
            {t("admin.wizard.step", {
              current: formatNumber(step + 1, lang),
              total: formatNumber(STEPS.length, lang),
            })}
          </p>
        </aside>
      </div>
    </AdminShell>
  );
}
