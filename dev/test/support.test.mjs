import assert from "node:assert/strict";
import test from "node:test";
import { createFakeDb } from "./fake-db.mjs";
import { PASSWORD, call, login, makeApp, setupWithOwner } from "./helpers.mjs";
import { seedBaseline } from "../../functions/seed.mjs";
import { PRODUCTS } from "../../functions/seed-data/products.mjs";
import { VARIANTS } from "../../functions/seed-data/variants.mjs";

const MUG = PRODUCTS.find((product) => product.slug === "stone-ceramic-mug");
const MUG_STONE = VARIANTS.find(
  (variant) => variant.product_id === MUG.id && variant.option_label_en === "Stone",
);

async function supportApp() {
  const db = createFakeDb();
  await seedBaseline(db);
  const app = makeApp(db);
  await setupWithOwner(app);
  const owner = await login(app, "owner@lootpat.test");
  assert.equal(owner.status, 200, JSON.stringify(owner.json));
  return { db, app, ownerCookie: owner.cookie, ownerId: owner.json.user.id };
}

async function addStaff(app, ownerCookie, role, email) {
  const created = await call(app, "POST", "/api/admin/team", {
    cookie: ownerCookie,
    body: { name: `Test ${role}`, email, password: PASSWORD, role },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return { id: created.json.id, cookie: (await login(app, email)).cookie };
}

function orderBody(phone = "01812345678") {
  return {
    items: [{ productId: MUG.id, variantId: MUG_STONE.id, qty: 1 }],
    customer: {
      name: "Nila Hasan",
      phone,
      districtId: "dhaka",
      area: "Uttara",
      address: "House 9, Road 7, Uttara",
      marketingConsent: false,
    },
    paymentMethod: "cod",
    idempotencyKey: crypto.randomUUID(),
  };
}

async function startChat(app, ip, body) {
  const started = await call(app, "POST", "/api/support/start", { body, ip });
  assert.equal(started.status, 201, JSON.stringify(started.json));
  return started.json;
}

test("starting a chat answers from live store data and stores only the token digest", async () => {
  const { db, app } = await supportApp();

  const started = await startChat(app, "198.51.100.101", {
    name: "Nila",
    message: "ডেলিভারি চার্জ কত?",
    locale: "bn",
  });

  assert.equal(started.conversation.status, "bot");
  assert.equal(started.messages.length, 2);
  assert.equal(started.messages[0].authorType, "customer");
  assert.equal(started.messages[1].authorType, "assistant");
  assert.match(started.messages[1].body, /৮০/);
  assert.match(started.messages[1].body, /১২০/);
  assert.ok(Array.isArray(started.quickReplies));
  assert.ok(started.token.length >= 20);
  assert.ok(!("access_token_hash" in started.conversation));

  const stored = db.dump("support_conversations");
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].access_token_hash, started.token);
  assert.ok(
    !JSON.stringify(stored).includes(started.token),
    "the raw token must never be persisted",
  );

  const session = await call(app, "POST", "/api/support/session", {
    body: { token: started.token },
  });
  assert.equal(session.status, 200);
  assert.equal(session.json.messages.length, 2);

  const guessed = await call(app, "POST", "/api/support/session", {
    body: { token: "a".repeat(43) },
  });
  assert.equal(guessed.status, 404);
  assert.equal(guessed.json.error, "conversation_not_found");
});

test("order status needs both the order number and its phone", async () => {
  const { app } = await supportApp();
  const placed = await call(app, "POST", "/api/orders", {
    body: orderBody("01812345678"),
    ip: "198.51.100.102",
  });
  assert.equal(placed.status, 201, JSON.stringify(placed.json));
  const orderNumber = placed.json.order.orderNumber;

  const noPhone = await startChat(app, "198.51.100.103", {
    name: "Rafi",
    orderNumber,
    message: "অর্ডার স্ট্যাটাস কী?",
    locale: "bn",
  });
  assert.match(noPhone.messages[1].body, /যাচাই/);

  const verified = await call(app, "POST", "/api/support/messages", {
    body: { token: noPhone.token, message: "01812345678" },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.json));
  const reply = verified.json.messages[1];
  assert.equal(reply.authorType, "assistant");
  assert.ok(reply.body.includes(orderNumber), reply.body);
  assert.match(reply.body, /অপেক্ষমাণ/);
  assert.match(reply.body, /বাকি/);
  assert.equal(verified.json.conversation.orderNumber, orderNumber);

  const wrongPhone = await startChat(app, "198.51.100.104", {
    name: "Rafi",
    orderNumber,
    phone: "01999999999",
    message: "আমার অর্ডার কোথায়?",
    locale: "bn",
  });
  assert.match(wrongPhone.messages[1].body, /পাওয়া যায়নি/);
  const serialized = JSON.stringify(wrongPhone);
  assert.ok(!serialized.includes("Nila Hasan"), "another customer's name must not leak");
  assert.ok(!serialized.includes("Uttara"), "another customer's address must not leak");
});

test("handoff moves the chat to the staff queue and a reply opens it", async () => {
  const { app, ownerCookie } = await supportApp();
  const started = await startChat(app, "198.51.100.105", {
    name: "Nila",
    message: "আমি এজেন্টের সাথে কথা বলতে চাই",
    locale: "bn",
  });
  assert.equal(started.conversation.status, "waiting");
  assert.equal(started.messages[1].intent, "handoff");

  const inbox = await call(app, "GET", "/api/admin/support", { cookie: ownerCookie });
  assert.equal(inbox.status, 200);
  assert.equal(inbox.json.counts.waiting, 1);
  const item = inbox.json.conversations.find((row) => row.id === started.conversation.id);
  assert.ok(item, "the waiting chat must appear in the inbox");
  assert.equal(item.status, "waiting");
  assert.equal(item.sla.state, "ok");
  assert.equal(item.lastMessage.authorType, "assistant");

  const replied = await call(
    app,
    "POST",
    `/api/admin/support/${started.conversation.id}/reply`,
    { cookie: ownerCookie, body: { body: "আমরা অর্ডারটি দেখছি, ১০ মিনিটের মধ্যে জানাচ্ছি।" } },
  );
  assert.equal(replied.status, 200, JSON.stringify(replied.json));
  assert.equal(replied.json.conversation.status, "open");
  assert.ok(replied.json.conversation.firstResponseAt);
  const last = replied.json.messages[replied.json.messages.length - 1];
  assert.equal(last.authorType, "staff");
  assert.equal(last.authorName, "Owner");
  assert.equal(replied.json.conversation.sla.state, "answered");

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  const entry = audit.json.entries.find((row) => row.action === "support.reply");
  assert.ok(entry, "staff replies must be audited");
  assert.equal(entry.entityId, started.conversation.id);
});

test("viewers can read the inbox but cannot reply or assign", async () => {
  const { app, ownerCookie } = await supportApp();
  const started = await startChat(app, "198.51.100.106", {
    name: "Nila",
    message: "রিটার্ন করা যাবে?",
  });
  const viewer = await addStaff(app, ownerCookie, "viewer", "viewer@lootpat.test");

  const anonymous = await call(app, "GET", "/api/admin/support");
  assert.equal(anonymous.status, 401);

  const read = await call(app, "GET", "/api/admin/support", { cookie: viewer.cookie });
  assert.equal(read.status, 200);
  assert.ok(!JSON.stringify(read.json).includes("access_token_hash"));

  const reply = await call(app, "POST", `/api/admin/support/${started.conversation.id}/reply`, {
    cookie: viewer.cookie,
    body: { body: "উত্তর" },
  });
  assert.equal(reply.status, 403);

  const assign = await call(app, "POST", `/api/admin/support/${started.conversation.id}/assign`, {
    cookie: viewer.cookie,
    body: { assigneeId: viewer.id },
  });
  assert.equal(assign.status, 403);
});

test("assignment, canned replies and closing leave an audited trail", async () => {
  const { db, app, ownerCookie } = await supportApp();
  const admin = await addStaff(app, ownerCookie, "admin", "admin@lootpat.test");
  const started = await startChat(app, "198.51.100.107", {
    name: "Nila",
    message: "ওয়ারেন্টি আছে?",
  });

  const assigned = await call(
    app,
    "POST",
    `/api/admin/support/${started.conversation.id}/assign`,
    { cookie: ownerCookie, body: { assigneeId: admin.id } },
  );
  assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
  assert.equal(assigned.json.conversation.assignedTo, "Test admin");
  assert.equal(assigned.json.conversation.status, "open");

  const canned = await call(app, "GET", "/api/admin/support/canned", { cookie: ownerCookie });
  assert.equal(canned.status, 200);
  assert.equal(canned.json.canned.length, 6);

  const cannedReply = await call(
    app,
    "POST",
    `/api/admin/support/${started.conversation.id}/reply`,
    { cookie: admin.cookie, body: { cannedId: "canned-greeting" } },
  );
  assert.equal(cannedReply.status, 200, JSON.stringify(cannedReply.json));
  const last = cannedReply.json.messages[cannedReply.json.messages.length - 1];
  assert.match(last.body, /ধন্যবাদ যোগাযোগের জন্য/);

  const created = await call(app, "POST", "/api/admin/support/canned", {
    cookie: ownerCookie,
    body: {
      title: "ডেলিভারি নম্বর",
      body: "কুরিয়ারের ট্র্যাকিং নম্বরটি SMS-এ পাঠানো হয়েছে।",
      locale: "bn",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.canned.length, 7);
  assert.ok(created.json.canned.some((row) => row.title === "ডেলিভারি নম্বর"));

  const closed = await call(app, "POST", `/api/admin/support/${started.conversation.id}/close`, {
    cookie: ownerCookie,
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.json.conversation.status, "resolved");
  assert.ok(closed.json.conversation.closedAt);
  assert.equal(closed.json.messages[closed.json.messages.length - 1].authorType, "system");

  const afterClose = await call(app, "POST", "/api/support/messages", {
    body: { token: started.token, message: "আবার লিখছি" },
  });
  assert.equal(afterClose.status, 409);
  assert.equal(afterClose.json.error, "conversation_closed");

  const audit = await call(app, "GET", "/api/admin/audit", { cookie: ownerCookie });
  const actions = audit.json.entries.map((row) => row.action);
  for (const action of ["support.assign", "support.reply", "support.close", "support.canned.create"]) {
    assert.ok(actions.includes(action), `${action} should be audited`);
  }
  assert.equal(db.dump("support_conversations")[0].status, "resolved");
});

test("handoff endpoint queues a bot chat without a staff round trip", async () => {
  const { app } = await supportApp();
  const started = await startChat(app, "198.51.100.108", {
    name: "Rafi",
    message: "পেমেন্ট কীভাবে করব?",
  });
  assert.equal(started.conversation.status, "bot");

  const handoff = await call(app, "POST", "/api/support/handoff", {
    body: { token: started.token },
  });
  assert.equal(handoff.status, 200, JSON.stringify(handoff.json));
  assert.equal(handoff.json.conversation.status, "waiting");
  assert.ok(handoff.json.conversation.slaDueAt);
  const last = handoff.json.messages[handoff.json.messages.length - 1];
  assert.equal(last.authorType, "assistant");
  assert.equal(last.intent, "handoff");

  const again = await call(app, "POST", "/api/support/handoff", {
    body: { token: started.token },
  });
  assert.equal(again.status, 200);
  assert.equal(
    again.json.messages.filter((message) => message.intent === "handoff").length,
    1,
    "handoff must be idempotent",
  );

  // While a human owns the chat the assistant stays silent.
  const customer = await call(app, "POST", "/api/support/messages", {
    body: { token: started.token, message: "আছেন?" },
  });
  assert.equal(customer.status, 200);
  assert.equal(customer.json.messages.length, 1);
  assert.equal(customer.json.reply.handoffSuggested, false);
});

test("the FAQ list is localized and refuses unknown input", async () => {
  const { app } = await supportApp();

  const english = await call(app, "GET", "/api/support/faq?locale=en");
  assert.equal(english.status, 200);
  assert.equal(english.json.faqs.length, 6);
  assert.equal(english.json.faqs[0].question, "How long does delivery take?");
  assert.ok(!("answer_bn" in english.json.faqs[0]));

  const bangla = await call(app, "GET", "/api/support/faq?locale=bn");
  assert.equal(bangla.status, 200);
  assert.equal(bangla.json.faqs[0].question, "ডেলিভারি কত দিনে পাব?");

  const invalid = await call(app, "GET", "/api/support/faq?locale=fr");
  assert.equal(invalid.status, 400);
});

test("new chats are rate limited per client address", async () => {
  const { app } = await supportApp();
  const body = { name: "Nila", message: "হ্যালো" };
  for (let index = 0; index < 6; index += 1) {
    const started = await call(app, "POST", "/api/support/start", {
      body,
      ip: "198.51.100.109",
    });
    assert.equal(started.status, 201, `start ${index + 1} should pass`);
  }
  const blocked = await call(app, "POST", "/api/support/start", {
    body,
    ip: "198.51.100.109",
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error, "rate_limited");
  assert.ok(blocked.headers.get("retry-after"));
});
