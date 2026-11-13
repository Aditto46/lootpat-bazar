// FAQ-grounded support assistant. Every answer is either computed from live
// store data (delivery charges, payment availability, a phone-verified order)
// or taken from the seeded FAQ rows. When neither applies the reply is
// escalated to a human instead of being invented.
import { rows, secureCompare } from "./http.mjs";
import { ORDER_NUMBER_PATTERN, canonicalPhone } from "./validate.mjs";
import { readSettings } from "./checkout.mjs";
import { gatewayAvailability } from "./payment-providers.mjs";

export const SUPPORT_SLA_MINUTES = 15;

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const PHONE_PATTERN = /(?:\+?880|0)1[3-9]\d{8}/;

const HANDOFF_PATTERN = /(এজেন্ট|মানুষের সাথে|কথা বলতে চাই|অপারেটর|agent|human|operator|representative|live person)/i;
const CANCEL_PATTERN = /(বাতিল|cancel|ক্যান্সেল)/i;
const PAYMENT_PATTERN = /(পেমেন্ট|payment|bkash|nagad|sslcommerz|কার্ড|card|ভিসা|visa|মাস্টারকার্ড|mastercard|অনলাইন পেমেন্ট)/i;
const DELIVERY_CHARGE_PATTERN = /(ডেলিভারি চার্জ|ডেলিভারি খরচ|delivery charge|শিপিং চার্জ|shipping charge|ফ্রি ডেলিভারি|free delivery|চার্জ কত)/i;
const COD_PATTERN = /(cod|cash on delivery|ক্যাশ অন ডেলিভারি)/i;
const DELIVERY_TIME_PATTERN = /(কত দিন|কতদিন|কবে পাব|কখন পাব|delivery time|how long|how many days|কবে পৌঁছাবে)/i;
const RETURN_PATTERN = /(রিটার্ন|ফেরত|এক্সচেঞ্জ|exchange|return|refund|রিফান্ড)/i;
const COUPON_PATTERN = /(কুপন|coupon|ডিসকাউন্ট|discount|ছাড়|promo|প্রোমো)/i;
const TRACKING_PATTERN = /(ট্র্যাক|track|কোথায় আছে|অর্ডার স্ট্যাটাস|order status|স্ট্যাটাস|status)/i;
const WARRANTY_PATTERN = /(ওয়ারেন্টি|warranty|আসল|genuine|original|নকল)/i;
const GREETING_PATTERN = /^(?:hi|hello|hey|assalamu|আসসালামু|সালাম|হ্যালো|হাই|শুভ সকাল)(?:[\s!.,।]|$)/i;
const ORDER_HINT_PATTERN = /(অর্ডার|order)/i;

const STATUS_LABEL = {
  bn: {
    pending: "অপেক্ষমাণ",
    confirmed: "কনফার্মড",
    packed: "প্যাক করা হয়েছে",
    shipped: "কুরিয়ারে পাঠানো হয়েছে",
    delivered: "ডেলিভারি সম্পন্ন",
    returned: "ফেরত এসেছে",
    cancelled: "বাতিল",
  },
  en: {
    pending: "pending",
    confirmed: "confirmed",
    packed: "packed",
    shipped: "shipped",
    delivered: "delivered",
    returned: "returned",
    cancelled: "cancelled",
  },
};

const PAYMENT_LABEL = {
  bn: {
    unpaid: "বাকি",
    pending: "অপেক্ষমাণ",
    paid: "পরিশোধিত",
    failed: "ব্যর্থ",
    refunded: "ফেরত দেওয়া হয়েছে",
  },
  en: {
    unpaid: "not paid",
    pending: "pending",
    paid: "paid",
    failed: "failed",
    refunded: "refunded",
  },
};

const COPY = {
  bn: {
    greeting:
      "আসসালামু আলাইকুম! লুটপাট বাজারের সাপোর্ট চ্যাটে স্বাগতম। অর্ডার স্ট্যাটাস, ডেলিভারি, রিটার্ন বা পেমেন্ট — যা জানতে চান লিখুন, সাথে সাথে উত্তর দিচ্ছি।",
    handoff:
      "আপনাকে একজন এজেন্টের সাথে যুক্ত করছি। অফিস সময়ে (শনি–বৃহস্পতি, সকাল ১০টা – রাত ৮টা) সাধারণত ১৫ মিনিটের মধ্যে উত্তর পাবেন। ততক্ষণে অর্ডার নম্বরসহ বিস্তারিত লিখে রাখুন।",
    needOrderNumber:
      "অর্ডারের সর্বশেষ অবস্থা জানতে অর্ডার নম্বরটি (যেমন LP-261113-A1B2C3) লিখুন। নম্বরটি কনফার্মেশন SMS-এ আছে; চাইলে /track পেজেও দেখতে পারবেন।",
    needPhone:
      "অর্ডারটি যাচাই করতে যে মোবাইল নম্বর দিয়ে অর্ডার করেছিলেন সেটি লিখুন (যেমন 017XXXXXXXX)। নিরাপত্তার জন্য অর্ডার নম্বর ও নম্বর — দুটোই মিলতে হবে।",
    orderNotFound:
      "এই অর্ডার নম্বর ও মোবাইল নম্বর মিলে কোনো অর্ডার পাওয়া যায়নি। দুটোই আবার দেখে নিন, অথবা এজেন্টের সাথে কথা বলতে \"এজেন্ট\" লিখুন।",
    cancelPolicy:
      "শিপিংয়ের আগে পর্যন্ত অর্ডার বাতিল করা যায়। অর্ডার নম্বরসহ এজেন্টকে জানান; শিপড হয়ে গেলে পণ্য পেয়ে ৭ দিনের মধ্যে রিটার্ন প্রক্রিয়া অনুসরণ করতে হবে।",
    returnPolicy:
      "পণ্য পাওয়ার ৭ দিনের মধ্যে রিটার্ন বা এক্সচেঞ্জ করা যাবে, যদি পণ্য অব্যবহৃত থাকে এবং ট্যাগ ও প্যাকেজিং অক্ষত থাকে। অর্ডার নম্বরসহ এজেন্টকে জানালে আমরা প্রক্রিয়া শুরু করব।",
    couponPolicy:
      "চেকআউটেই কুপন কোড লিখে প্রয়োগ চাপুন। শর্ত (সর্বনিম্ন কেনাকাটা ও মেয়াদ) পূরণ হলে ছাড় সাথে সাথে দেখাবে। এক অর্ডারে একবারই কুপন ব্যবহার করা যায়।",
    warrantyPolicy:
      "সব পণ্য আমাদের যাচাই করা সাপ্লায়ার থেকে আনা এবং ছবির সাথে মেলে। ইলেকট্রনিক্সে ব্র্যান্ডের ওয়ারেন্টি প্রযোজ্য; সমস্যা হলে ডেলিভারির ৭ দিনের মধ্যে জানান।",
    fallback:
      "এই প্রশ্নের নির্ভরযোগ্য উত্তর আমার কাছে নেই, তাই অনুমান করছি না। চাইলে এজেন্টের সাথে কথা বলতে পারেন — \"এজেন্ট\" লিখে পাঠান, অফিস সময়ে গড়ে ১৫ মিনিটে উত্তর পাবেন।",
    quickReplies: [
      "ডেলিভারি কত দিনে পাব?",
      "ডেলিভারি চার্জ কত?",
      "রিটার্ন করা যাবে?",
      "কীভাবে পেমেন্ট করব?",
    ],
  },
  en: {
    greeting:
      "Hello! Welcome to LootPat Bazar support. Ask me about order status, delivery, returns or payments and I will answer right away.",
    handoff:
      "Connecting you to a human agent. During office hours (Sat–Thu, 10am–8pm) you can usually expect a reply within 15 minutes. Meanwhile, share your order number and any detail that helps.",
    needOrderNumber:
      "To check the latest status, send your order number (for example LP-261113-A1B2C3). It is in your confirmation SMS, and you can also use the /track page.",
    needPhone:
      "To verify the order, send the mobile number used at checkout (for example 017XXXXXXXX). For your security the order number and phone must both match.",
    orderNotFound:
      "No order matches that order number and phone. Please check both, or type \"agent\" to talk to a person.",
    cancelPolicy:
      "Orders can be cancelled before they ship. Tell the agent your order number as soon as possible; once shipped, use the 7-day return process after delivery.",
    returnPolicy:
      "Returns and exchanges are accepted within 7 days of delivery if the item is unused and tags and packaging are intact. Give the agent your order number to start.",
    couponPolicy:
      "Enter the coupon code at checkout and press apply. If the minimum spend and validity match, the discount appears immediately. One coupon per order.",
    warrantyPolicy:
      "All items come from verified suppliers and match the photos. Electronics carry the brand warranty; report any problem within 7 days of delivery.",
    fallback:
      "I do not have a reliable answer for that, so I will not guess. You can talk to a person — type \"agent\" and we will reply, usually within 15 minutes during office hours.",
    quickReplies: [
      "How long does delivery take?",
      "What is the delivery charge?",
      "Can I return an item?",
      "How can I pay?",
    ],
  },
};

const lower = (value) => String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();

function bnNumber(value) {
  return String(value).replace(/\d/g, (digit) => BN_DIGITS[Number(digit)]);
}

function money(paisa, lang) {
  const whole = Math.round(Number(paisa) || 0);
  const taka = Math.floor(whole / 100);
  const fraction = whole % 100;
  const text = fraction === 0 ? String(taka) : `${taka}.${String(fraction).padStart(2, "0")}`;
  return lang === "bn" ? `৳${bnNumber(text)}` : `৳${text}`;
}

function dateOnly(iso, lang) {
  const text = String(iso ?? "").slice(0, 10);
  return lang === "bn" ? bnNumber(text) : text;
}

function matchOrderNumber(text) {
  const match = String(text).toUpperCase().match(ORDER_NUMBER_PATTERN);
  return match ? match[0] : null;
}

function matchPhone(text) {
  const match = String(text).match(PHONE_PATTERN);
  if (!match) return null;
  try {
    return canonicalPhone(match[0]);
  } catch {
    return null;
  }
}

export function detectPhone(text) {
  return matchPhone(text);
}

export function handoffMessage(locale) {
  return COPY[locale === "en" ? "en" : "bn"].handoff;
}

async function findOrder(db, orderNumber) {
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) return null;
  const found = rows(
    await db
      .from("orders")
      .select(
        "id,order_number,status,payment_method,payment_status,courier,tracking_number,courier_status,total_paisa,phone,created_at",
      )
      .eq("order_number", orderNumber)
      .limit(1),
  );
  return found.length === 1 ? found[0] : null;
}

function orderSummary(order, lang) {
  const status = STATUS_LABEL[lang][order.status] ?? order.status;
  const payment = PAYMENT_LABEL[lang][order.payment_status] ?? order.payment_status;
  const lines = [];
  if (lang === "bn") {
    lines.push(`অর্ডার ${order.order_number} — অবস্থা: ${status}।`);
    lines.push(`পেমেন্ট: ${payment}। মোট: ${money(order.total_paisa, lang)}।`);
    if (order.courier && order.courier !== "manual") {
      const tracking = order.tracking_number
        ? `, ট্র্যাকিং নম্বর ${order.tracking_number}`
        : "";
      lines.push(`কুরিয়ার: ${order.courier}${tracking}।`);
    }
    lines.push(`অর্ডার করা হয়েছে ${dateOnly(order.created_at, lang)}।`);
    if (order.status === "shipped") {
      lines.push("পার্সেলটি কুরিয়ারে আছে; ঢাকায় ২৪ ঘণ্টা এবং ঢাকার বাইরে ২–৩ কর্মদিবসে পৌঁছাবে।");
    }
  } else {
    lines.push(`Order ${order.order_number} is ${status}.`);
    lines.push(`Payment: ${payment}. Total: ${money(order.total_paisa, lang)}.`);
    if (order.courier && order.courier !== "manual") {
      const tracking = order.tracking_number ? `, tracking ${order.tracking_number}` : "";
      lines.push(`Courier: ${order.courier}${tracking}.`);
    }
    lines.push(`Placed on ${dateOnly(order.created_at, lang)}.`);
    if (order.status === "shipped") {
      lines.push("The parcel is with the courier: 24 hours inside Dhaka, 2–3 working days elsewhere.");
    }
  }
  return lines.join(" ");
}

async function orderReply(db, lang, orderNumber, phone) {
  const result = (body, intent = "order_status", handoffSuggested = false) => ({
    intent,
    handoffSuggested,
    body,
    quickReplies: [],
    detected: { orderNumber, phone },
  });

  const order = await findOrder(db, orderNumber);
  if (!order) return result(COPY[lang].orderNotFound);
  if (!phone) return result(COPY[lang].needPhone);
  if (!(await secureCompare(order.phone, phone))) return result(COPY[lang].orderNotFound);
  return result(orderSummary(order, lang));
}

function deliveryChargeAnswer(settings, lang) {
  const { dhakaPaisa, outsidePaisa, freeThresholdPaisa } = settings.delivery;
  if (lang === "bn") {
    const free = freeThresholdPaisa > 0
      ? ` ${money(freeThresholdPaisa, lang)} বা তার বেশি অর্ডারে ডেলিভারি ফ্রি।`
      : "";
    return `ঢাকার ভিতরে ডেলিভারি চার্জ ${money(dhakaPaisa, lang)} এবং ঢাকার বাইরে ${money(outsidePaisa, lang)}।${free}`;
  }
  const free = freeThresholdPaisa > 0
    ? ` Orders of ${money(freeThresholdPaisa, lang)} or more ship free.`
    : "";
  return `Delivery is ${money(dhakaPaisa, lang)} inside Dhaka and ${money(outsidePaisa, lang)} outside Dhaka.${free}`;
}

function paymentAnswer(settings, env, lang) {
  const gateways = gatewayAvailability(settings, env);
  const online = Object.entries(gateways.providers)
    .filter(([, provider]) => provider.available)
    .map(([, provider]) => provider.label);
  const cod = settings.delivery.codEnabled
    ? lang === "bn" ? "ক্যাশ অন ডেলিভারি" : "cash on delivery"
    : null;

  if (lang === "bn") {
    const methods = [cod, online.length ? `${online.join(", ")} (অনলাইন)` : null].filter(Boolean);
    if (methods.length === 0) {
      return "এই মুহূর্তে অনলাইন পেমেন্ট চালু নেই। বিস্তারিত জানতে এজেন্টের সাথে কথা বলুন।";
    }
    return `পেমেন্টের জন্য ${methods.join(" এবং ")} ব্যবহার করতে পারবেন। অনলাইন পেমেন্ট চালু থাকলে অর্ডারের পর পেমেন্ট পেজ থেকেই সম্পন্ন করা যায়। কার্ডের তথ্য আমরা কখনো সংরক্ষণ করি না।`;
  }
  const methods = [cod, online.length ? `${online.join(", ")} online` : null].filter(Boolean);
  if (methods.length === 0) {
    return "Online payment is not enabled right now. Please talk to an agent for the available options.";
  }
  return `You can pay with ${methods.join(" or ")}. When online payment is enabled you finish it from the payment page after ordering. Card details are never stored.`;
}

function codAnswer(settings, lang) {
  if (!settings.delivery.codEnabled) {
    return lang === "bn"
      ? "এই মুহূর্তে ক্যাশ অন ডেলিভারি বন্ধ আছে। অনলাইন পেমেন্ট বা এজেন্টের সহায়তা নিন।"
      : "Cash on delivery is currently disabled. Please use online payment or ask an agent.";
  }
  return lang === "bn"
    ? `ক্যাশ অন ডেলিভারিতে সর্বোচ্চ ${money(settings.delivery.codLimitPaisa, lang)} পর্যন্ত অর্ডার করা যায়। পণ্য হাতে পেয়ে কুরিয়ারকে টাকা দেবেন।`
    : `Cash on delivery is available up to ${money(settings.delivery.codLimitPaisa, lang)}. You pay the courier when the parcel arrives.`;
}

function tokenize(text) {
  return lower(text)
    .split(/[^a-z0-9\u0980-\u09FF]+/u)
    .filter((token) => token.length >= 2);
}

async function loadFaqs(db) {
  try {
    const list = rows(
      await db
        .from("faq_entries")
        .select("id,question_bn,question_en,answer_bn,answer_en,keywords,position,published")
        .limit(50),
    ).filter((row) => row.published !== false);
    return list.sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
  } catch {
    return [];
  }
}

function scoreFaq(entry, normalized, tokens) {
  let score = 0;
  const keywords = String(entry.keywords ?? "")
    .split(",")
    .map((keyword) => lower(keyword))
    .filter((keyword) => keyword.length >= 2);
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) score += keyword.length >= 4 ? 3 : 2;
  }
  const questionTokens = new Set(tokenize(`${entry.question_bn} ${entry.question_en}`));
  for (const token of tokens) if (questionTokens.has(token)) score += 1;
  return score;
}

function plain(body, intent, handoffSuggested = false) {
  return { intent, handoffSuggested, body, quickReplies: [], detected: { orderNumber: null, phone: null } };
}

export async function respond({ db, env, locale, message, conversation }) {
  const lang = locale === "en" ? "en" : "bn";
  const text = typeof message === "string" ? message : "";
  const normalized = lower(text);
  const typedNumber = matchOrderNumber(text);
  const typedPhone = matchPhone(text);
  const knownNumber = conversation?.order_number ?? null;
  const knownPhone = conversation?.customer_phone ?? null;

  if (HANDOFF_PATTERN.test(text)) {
    return { ...plain(COPY[lang].handoff, "handoff", true), quickReplies: [] };
  }

  if (typedNumber || (typedPhone && knownNumber)) {
    return orderReply(db, lang, typedNumber ?? knownNumber, typedPhone ?? knownPhone);
  }

  if (CANCEL_PATTERN.test(text)) {
    return { ...plain(COPY[lang].cancelPolicy, "cancellation"), quickReplies: [] };
  }

  const settings = await readSettings(db);

  if (PAYMENT_PATTERN.test(text)) {
    return plain(paymentAnswer(settings, env, lang), "payment");
  }
  if (COD_PATTERN.test(text)) {
    return plain(codAnswer(settings, lang), "payment");
  }
  if (DELIVERY_CHARGE_PATTERN.test(text)) {
    return plain(deliveryChargeAnswer(settings, lang), "delivery");
  }
  if (DELIVERY_TIME_PATTERN.test(text)) {
    const faq = (await loadFaqs(db)).find((entry) => entry.id === "faq-delivery-time");
    if (faq) return plain(lang === "bn" ? faq.answer_bn : faq.answer_en, "delivery");
    return plain(deliveryChargeAnswer(settings, lang), "delivery");
  }
  if (RETURN_PATTERN.test(text)) {
    return plain(COPY[lang].returnPolicy, "returns");
  }
  if (COUPON_PATTERN.test(text)) {
    return plain(COPY[lang].couponPolicy, "coupons");
  }
  if (ORDER_HINT_PATTERN.test(normalized) || TRACKING_PATTERN.test(text)) {
    // A number supplied at chat start is kept, so the phone alone can unlock it.
    if (knownNumber) {
      return orderReply(db, lang, knownNumber, typedPhone ?? knownPhone);
    }
    return plain(COPY[lang].needOrderNumber, "order_status");
  }
  if (WARRANTY_PATTERN.test(text)) {
    return plain(COPY[lang].warrantyPolicy, "products");
  }
  if (GREETING_PATTERN.test(normalized) || normalized === "hi" || normalized === "হাই") {
    return {
      intent: "greeting",
      handoffSuggested: false,
      body: COPY[lang].greeting,
      quickReplies: COPY[lang].quickReplies,
      detected: { orderNumber: null, phone: null },
    };
  }

  const tokens = tokenize(text);
  let best = null;
  let bestScore = 0;
  for (const entry of await loadFaqs(db)) {
    const score = scoreFaq(entry, normalized, tokens);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  if (best && bestScore >= 4) {
    return {
      ...plain(lang === "bn" ? best.answer_bn : best.answer_en, "faq"),
      quickReplies: [],
    };
  }

  return {
    ...plain(COPY[lang].fallback, "fallback", true),
    quickReplies: COPY[lang].quickReplies,
  };
}
