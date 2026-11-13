// FAQ knowledge base and starter canned replies for the Step 7 support inbox.
// The assistant answers from these rows only, so a missing answer is escalated
// to a human instead of being invented.

export const FAQ_ENTRIES = [
  {
    id: "faq-delivery-time",
    question_bn: "ডেলিভারি কত দিনে পাব?",
    question_en: "How long does delivery take?",
    answer_bn:
      "ঢাকার ভিতরে সাধারণত ২৪ ঘণ্টা এবং ঢাকার বাইরে ২–৩ কর্মদিবসে পৌঁছায়। অর্ডার কনফার্ম হলে আপনার মোবাইলে SMS-এ ট্র্যাকিং তথ্য পাঠানো হয়।",
    answer_en:
      "Dhaka usually arrives within 24 hours; the rest of Bangladesh takes 2–3 working days. Once the order is confirmed we send tracking information by SMS.",
    keywords: "delivery,ডেলিভারি,কতদিন,কবে পাব,shipping,কুরিয়ার,পৌঁছাবে",
    category: "delivery",
    sort_order: 1,
  },
  {
    id: "faq-delivery-charge",
    question_bn: "ডেলিভারি চার্জ কত?",
    question_en: "What is the delivery charge?",
    answer_bn:
      "ঢাকার ভিতরে ৳৮০ এবং ঢাকার বাইরে ৳১২০। ৳২,৫০০ বা তার বেশি অর্ডারে ডেলিভারি ফ্রি। চেকআউটে জেলা বেছে নিলে সঠিক চার্জ দেখতে পাবেন।",
    answer_en:
      "৳80 inside Dhaka and ৳120 outside Dhaka. Delivery is free on orders of ৳2,500 or more. Choose your district at checkout to see the exact charge.",
    keywords: "delivery charge,ডেলিভারি চার্জ,শিপিং,shipping,কত টাকা,ফ্রি ডেলিভারি,free delivery",
    category: "delivery",
    sort_order: 2,
  },
  {
    id: "faq-return",
    question_bn: "রিটার্ন বা এক্সচেঞ্জ করা যাবে?",
    question_en: "Can I return or exchange an item?",
    answer_bn:
      "পণ্য পাওয়ার ৭ দিনের মধ্যে রিটার্ন বা এক্সচেঞ্জ করা যাবে, যদি পণ্য অব্যবহৃত থাকে এবং ট্যাগ/প্যাকেজিং অক্ষত থাকে। অর্ডার নম্বরসহ হটলাইনে জানালে আমরা প্রক্রিয়া শুরু করব।",
    answer_en:
      "Returns and exchanges are accepted within 7 days of delivery if the item is unused and the tags and packaging are intact. Contact the hotline with your order number to start.",
    keywords: "return,রিটার্ন,ফেরত,exchange,এক্সচেঞ্জ,বদলানো,রিফান্ড,refund",
    category: "returns",
    sort_order: 3,
  },
  {
    id: "faq-payment",
    question_bn: "কী কী পেমেন্ট করা যায়?",
    question_en: "Which payment methods are available?",
    answer_bn:
      "ক্যাশ অন ডেলিভারি, bKash, Nagad এবং কার্ড/SSLCommerz। অনলাইন পেমেন্ট চালু থাকলে অর্ডারের পর পেমেন্ট পেজ থেকে সম্পন্ন করতে পারবেন। কার্ডের তথ্য আমরা কখনো সংরক্ষণ করি না।",
    answer_en:
      "Cash on delivery, bKash, Nagad and card/SSLCommerz. When online payment is enabled you can finish it from the order page. Card details are never stored.",
    keywords: "payment,পেমেন্ট,bkash,nagad,sslcommerz,কার্ড,card,cod,ক্যাশ অন ডেলিভারি",
    category: "payments",
    sort_order: 4,
  },
  {
    id: "faq-cod",
    question_bn: "ক্যাশ অন ডেলিভারি সীমা কত?",
    question_en: "What is the cash-on-delivery limit?",
    answer_bn:
      "COD-এ সর্বোচ্চ ৳১০,০০০ পর্যন্ত অর্ডার করা যায়। এর বেশি হলে অনলাইন পেমেন্ট ব্যবহার করুন। পণ্য হাতে পেয়ে কুরিয়ারকে টাকা দেবেন।",
    answer_en:
      "Cash on delivery is available up to ৳10,000. Above that, please use online payment. You pay the courier when the parcel arrives.",
    keywords: "cod,cash on delivery,ক্যাশ অন ডেলিভারি,সীমা,limit,টাকা দিব,pay on delivery",
    category: "payments",
    sort_order: 5,
  },
  {
    id: "faq-tracking",
    question_bn: "অর্ডারের স্ট্যাটাস কীভাবে দেখব?",
    question_en: "How do I check my order status?",
    answer_bn:
      "যেকোনো সময় /track পেজে অর্ডার নম্বর ও যে মোবাইল নম্বর দিয়ে অর্ডার করেছেন সেটি দিয়ে স্ট্যাটাস দেখতে পারবেন। অর্ডার কনফার্মেশন লিংক থেকেও ট্র্যাকিং দেখা যায়।",
    answer_en:
      "Open /track and enter your order number with the phone used to order. The order confirmation link also shows the live status.",
    keywords: "track,ট্র্যাক,স্ট্যাটাস,status,অর্ডার কোথায়,order status,কোথায় আছে",
    category: "orders",
    sort_order: 6,
  },
  {
    id: "faq-cancel",
    question_bn: "অর্ডার বাতিল করা যাবে?",
    question_en: "Can I cancel my order?",
    answer_bn:
      "শিপিংয়ের আগে পর্যন্ত অর্ডার বাতিল করা যায়। দ্রুত হটলাইনে অর্ডার নম্বরসহ জানান; শিপড হয়ে গেলে পণ্য পেয়ে রিটার্ন প্রক্রিয়া অনুসরণ করতে হবে।",
    answer_en:
      "Orders can be cancelled before they ship. Call the hotline with your order number as soon as possible; once shipped, use the return process after delivery.",
    keywords: "cancel,বাতিল,ক্যান্সেল,অর্ডার বাতিল,cancel order",
    category: "orders",
    sort_order: 7,
  },
  {
    id: "faq-coupon",
    question_bn: "কুপন কোড কীভাবে ব্যবহার করব?",
    question_en: "How do I use a coupon code?",
    answer_bn:
      "চেকআউট পেজে কুপন কোড লিখে প্রয়োগ চাপুন। শর্ত (সর্বনিম্ন কেনাকাটা, মেয়াদ) পূরণ হলে ছাড় সাথে সাথে দেখাবে। এক অর্ডারে একবারই কুপন ব্যবহার করা যায়।",
    answer_en:
      "Enter the code at checkout and press apply. If the minimum spend and validity match, the discount appears immediately. One coupon per order.",
    keywords: "coupon,কুপন,ডিসকাউন্ট,discount,ছাড়,promo,প্রোমো",
    category: "coupons",
    sort_order: 8,
  },
  {
    id: "faq-warranty",
    question_bn: "পণ্য কি আসল ও ওয়ারেন্টিসহ?",
    question_en: "Are the products genuine and under warranty?",
    answer_bn:
      "সব পণ্য আমাদের যাচাই করা সাপ্লায়ার থেকে আনা এবং ছবির সাথে মিলে যায়। ইলেকট্রনিক্সে ব্র্যান্ডের ওয়ারেন্টি প্রযোজ্য; সমস্যা হলে ৭ দিনের মধ্যে জানান।",
    answer_en:
      "All items come from verified suppliers and match the product photos. Electronics carry the brand warranty; report any problem within 7 days.",
    keywords: "genuine,আসল,ওয়ারেন্টি,warranty,নকল,original,quality",
    category: "products",
    sort_order: 9,
  },
  {
    id: "faq-contact",
    question_bn: "সরাসরি কার সাথে কথা বলব?",
    question_en: "How can I reach a person?",
    answer_bn:
      "হটলাইন +৮৮০ ১৪১০-২৮৬৮২২ (শনি–বৃহস্পতি, সকাল ১০টা – রাত ৮টা)। চাইলে এখানেই এজেন্টের সাথে লাইভ চ্যাট করতে পারেন — \"এজেন্ট\" লিখে পাঠান।",
    answer_en:
      "Call +880 1410-286822 (Sat–Thu, 10am–8pm). You can also chat live with an agent here — type \"agent\" to be connected.",
    keywords: "contact,যোগাযোগ,হটলাইন,hotline,ফোন,phone,whatsapp,সাপোর্ট,support",
    category: "general",
    sort_order: 10,
  },
];

export const CANNED_REPLIES = [
  {
    id: "canned-greeting",
    title: "স্বাগতম",
    body: "ধন্যবাদ যোগাযোগের জন্য! আপনার প্রশ্নটি পেয়েছি — একটু বিস্তারিত লিখলে দ্রুত সাহায্য করতে পারব।",
    locale: "bn",
    sort_order: 1,
  },
  {
    id: "canned-order-check",
    title: "অর্ডার তথ্য চাওয়া",
    body: "অর্ডারটি খুঁজে বের করতে অর্ডার নম্বর (LP-XXXXXX-XXXXXX) এবং যে মোবাইল নম্বর দিয়ে অর্ডার করেছিলেন সেটি জানান।",
    locale: "bn",
    sort_order: 2,
  },
  {
    id: "canned-delivery",
    title: "ডেলিভারি আপডেট",
    body: "আপনার অর্ডারটি কুরিয়ারে দেওয়া হয়েছে। ঢাকায় ২৪ ঘণ্টা এবং ঢাকার বাইরে ২–৩ কর্মদিবসে পৌঁছাবে। ট্র্যাকিং নম্বরটি SMS-এ পাঠানো হয়েছে।",
    locale: "bn",
    sort_order: 3,
  },
  {
    id: "canned-return",
    title: "রিটার্ন নির্দেশনা",
    body: "পণ্য অব্যবহৃত ও ট্যাগ অক্ষত থাকলে ডেলিভারির ৭ দিনের মধ্যে রিটার্ন করা যাবে। ছবি ও অর্ডার নম্বর পাঠালে আমরা রিটার্ন রিকোয়েস্ট খুলে দেব।",
    locale: "bn",
    sort_order: 4,
  },
  {
    id: "canned-greeting-en",
    title: "Welcome",
    body: "Thanks for reaching out! I have your message — share a little more detail and I will help right away.",
    locale: "en",
    sort_order: 5,
  },
  {
    id: "canned-order-check-en",
    title: "Ask for order details",
    body: "To find the order, please share the order number (LP-XXXXXX-XXXXXX) and the mobile number used at checkout.",
    locale: "en",
    sort_order: 6,
  },
];
