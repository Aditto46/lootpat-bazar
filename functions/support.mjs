// Live support chat. A conversation doubles as the ticket: the customer holds an
// opaque token whose digest is the only lookup key, so a conversation id alone
// can never read someone else's chat. Assistant replies come from
// functions/assistant.mjs; staff replies, assignment and closing go through the
// admin routes and are recorded in the audit log.
import { AppError, clientIp, json, readJson, rows } from "./http.mjs";
import { consume } from "./limiter.mjs";
import { newSessionToken, sha256Hex } from "./sessions.mjs";
import {
  adminCannedCreateSchema,
  adminSupportAssignSchema,
  adminSupportQuerySchema,
  adminSupportReplySchema,
  parse,
  supportFaqQuerySchema,
  supportMessageSchema,
  supportStartSchema,
  supportTokenSchema,
} from "./validate.mjs";
import { SUPPORT_SLA_MINUTES, handoffMessage, respond } from "./assistant.mjs";
import { recordAudit } from "./audit.mjs";

const CONVERSATION_COLUMNS =
  "id,access_token_hash,user_id,customer_name,customer_phone,order_number,locale,channel,status,assigned_to,sla_due_at,first_response_at,last_message_at,created_at,updated_at,closed_at";
const MESSAGE_COLUMNS =
  "id,conversation_id,author_type,author_id,body,intent,handoff_suggested,created_at";
const SLA_MS = SUPPORT_SLA_MINUTES * 60 * 1000;

const nowIso = () => new Date().toISOString();
const laterIso = (ms) => new Date(Date.now() + ms).toISOString();

function rateLimited(result) {
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  return json({ error: "rate_limited" }, 429, { "retry-after": String(seconds) });
}

async function limit(db, scope, subject) {
  const result = await consume(db, scope, subject);
  return result.allowed ? null : rateLimited(result);
}

async function findByToken(db, token) {
  const digest = await sha256Hex(token);
  const found = rows(
    await db
      .from("support_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("access_token_hash", digest)
      .limit(1),
  );
  if (found.length !== 1) throw new AppError("conversation_not_found", 404);
  return found[0];
}

async function findById(db, conversationId) {
  const found = rows(
    await db
      .from("support_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("id", conversationId)
      .limit(1),
  );
  if (found.length !== 1) throw new AppError("conversation_not_found", 404);
  return found[0];
}

function messagePayload(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    authorType: row.author_type,
    authorId: row.author_id ?? null,
    body: row.body,
    intent: row.intent ?? null,
    handoffSuggested: Boolean(row.handoff_suggested),
    createdAt: row.created_at,
  };
}

async function loadMessages(db, conversationId) {
  const list = rows(
    await db
      .from("support_messages")
      .select(MESSAGE_COLUMNS)
      .eq("conversation_id", conversationId)
      .limit(200),
  );
  return list
    .sort(
      (left, right) =>
        String(left.created_at).localeCompare(String(right.created_at)) ||
        String(left.id).localeCompare(String(right.id)),
    )
    .map(messagePayload);
}

async function appendMessage(db, conversationId, entry) {
  const row = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    author_type: entry.authorType,
    author_id: entry.authorId ?? null,
    body: entry.body,
    intent: entry.intent ?? null,
    handoff_suggested: Boolean(entry.handoffSuggested),
    created_at: entry.at ?? nowIso(),
  };
  const saved = rows(
    await db.from("support_messages").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (saved.length !== 1) throw new AppError("database_unavailable", 503);
  return messagePayload(row);
}

async function patchConversation(db, conversationId, patch) {
  const saved = rows(
    await db
      .from("support_conversations")
      .update({ ...patch, updated_at: nowIso() })
      .eq("id", conversationId)
      .select("id"),
  );
  if (saved.length !== 1) throw new AppError("conversation_not_found", 404);
}

function publicConversation(row) {
  return {
    id: row.id,
    status: row.status,
    locale: row.locale,
    customerName: row.customer_name,
    orderNumber: row.order_number ?? null,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    slaDueAt: row.sla_due_at ?? null,
    firstResponseAt: row.first_response_at ?? null,
    closedAt: row.closed_at ?? null,
  };
}

function slaState(row, now = Date.now()) {
  if (row.status === "resolved") return { state: "closed", minutesLeft: null };
  if (row.first_response_at) return { state: "answered", minutesLeft: null };
  const due = Date.parse(row.sla_due_at ?? "");
  if (!Number.isFinite(due)) return { state: "none", minutesLeft: null };
  const minutesLeft = Math.round((due - now) / 60000);
  const state = minutesLeft < 0 ? "overdue" : minutesLeft <= 5 ? "at-risk" : "ok";
  return { state, minutesLeft };
}

async function loadStaff(db) {
  const users = rows(
    await db.from("users").select("id,name,email,role_id,status,deleted_at").limit(100),
  );
  const roles = rows(
    await db.from("roles").select("id,name_bn,name_en,is_staff").limit(20),
  );
  const roleMap = new Map(roles.map((role) => [role.id, role]));
  return users
    .filter(
      (user) =>
        user.deleted_at == null &&
        user.status === "active" &&
        roleMap.get(user.role_id)?.is_staff === true,
    )
    .map((user) => {
      const role = roleMap.get(user.role_id);
      return {
        id: user.id,
        name: user.name,
        role: { id: user.role_id, name_bn: role.name_bn, name_en: role.name_en },
      };
    })
    .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

async function loadCanned(db) {
  const list = rows(
    await db
      .from("support_canned_replies")
      .select("id,title,body,locale,sort_order,created_at")
      .limit(100),
  );
  return list
    .sort(
      (left, right) =>
        (left.sort_order ?? 0) - (right.sort_order ?? 0) ||
        String(left.title).localeCompare(String(right.title)),
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      locale: row.locale,
      position: row.sort_order,
      created_at: row.created_at,
    }));
}

// ---------------------------------------------------------------------------
// Customer routes

export async function handleSupportStart(db, request, userId, env) {
  const throttled = await limit(db, "support_start", clientIp(request));
  if (throttled) return throttled;

  const body = parse(supportStartSchema, await readJson(request));
  const locale = body.locale ?? "bn";

  let name = body.name?.trim() ?? "";
  if (!name && userId) {
    const users = rows(
      await db.from("users").select("id,name").eq("id", userId).limit(1),
    );
    name = typeof users[0]?.name === "string" ? users[0].name.trim() : "";
  }
  if (name.length < 2) name = locale === "en" ? "Guest" : "অতিথি";

  const token = newSessionToken();
  const id = crypto.randomUUID();
  const created = new Date();
  const row = {
    id,
    access_token_hash: await sha256Hex(token),
    user_id: userId ?? null,
    customer_name: name,
    customer_phone: body.phone ?? null,
    order_number: body.orderNumber ?? null,
    locale,
    channel: "web",
    status: "bot",
    assigned_to: null,
    sla_due_at: new Date(created.getTime() + SLA_MS).toISOString(),
    first_response_at: null,
    last_message_at: created.toISOString(),
    created_at: created.toISOString(),
    updated_at: created.toISOString(),
    closed_at: null,
  };
  const saved = rows(
    await db.from("support_conversations").insertIfAbsent(row, { onConflict: "id" }).select("id"),
  );
  if (saved.length !== 1) throw new AppError("database_unavailable", 503);

  const customerMessage = await appendMessage(db, id, {
    authorType: "customer",
    authorId: userId ?? null,
    body: body.message,
    at: created.toISOString(),
  });
  const reply = await respond({
    db,
    env,
    locale,
    message: body.message,
    conversation: { order_number: row.order_number, customer_phone: row.customer_phone },
  });
  const assistantMessage = await appendMessage(db, id, {
    authorType: "assistant",
    body: reply.body,
    intent: reply.intent,
    handoffSuggested: reply.handoffSuggested,
    at: new Date(created.getTime() + 1).toISOString(),
  });

  const patch = { last_message_at: assistantMessage.createdAt };
  if (reply.detected?.orderNumber && !row.order_number) patch.order_number = reply.detected.orderNumber;
  if (reply.detected?.phone && !row.customer_phone) patch.customer_phone = reply.detected.phone;
  if (reply.intent === "handoff") {
    patch.status = "waiting";
    patch.sla_due_at = laterIso(SLA_MS);
  }
  await patchConversation(db, id, patch);

  return json(
    {
      conversation: publicConversation({ ...row, ...patch }),
      messages: [customerMessage, assistantMessage],
      token,
      quickReplies: reply.quickReplies,
    },
    201,
  );
}

export async function handleSupportSession(db, request) {
  const body = parse(supportTokenSchema, await readJson(request));
  const conversation = await findByToken(db, body.token);
  return json({
    conversation: publicConversation(conversation),
    messages: await loadMessages(db, conversation.id),
  });
}

export async function handleSupportMessage(db, request, env) {
  const body = parse(supportMessageSchema, await readJson(request));
  const digest = await sha256Hex(body.token);
  const throttled = await limit(db, "support_message", digest);
  if (throttled) return throttled;

  const conversation = await findByToken(db, body.token);
  if (conversation.status === "resolved") throw new AppError("conversation_closed", 409);

  const locale = body.locale ?? conversation.locale;
  const customerMessage = await appendMessage(db, conversation.id, {
    authorType: "customer",
    authorId: conversation.user_id ?? null,
    body: body.message,
  });
  const patch = { last_message_at: customerMessage.createdAt };
  const messages = [customerMessage];
  let quickReplies = [];
  let handoffSuggested = false;

  const awaitingHuman = conversation.status === "waiting" || conversation.status === "open";
  if (!awaitingHuman) {
    const reply = await respond({
      db,
      env,
      locale,
      message: body.message,
      conversation: {
        order_number: conversation.order_number,
        customer_phone: conversation.customer_phone,
      },
    });
    const assistantMessage = await appendMessage(db, conversation.id, {
      authorType: "assistant",
      body: reply.body,
      intent: reply.intent,
      handoffSuggested: reply.handoffSuggested,
      at: new Date(Date.parse(customerMessage.createdAt) + 1).toISOString(),
    });
    messages.push(assistantMessage);
    patch.last_message_at = assistantMessage.createdAt;
    quickReplies = reply.quickReplies;
    handoffSuggested = reply.handoffSuggested;
    if (reply.detected?.orderNumber && !conversation.order_number) {
      patch.order_number = reply.detected.orderNumber;
    }
    if (reply.detected?.phone && !conversation.customer_phone) {
      patch.customer_phone = reply.detected.phone;
    }
    if (reply.intent === "handoff") {
      patch.status = "waiting";
      patch.sla_due_at = laterIso(SLA_MS);
    }
  }

  await patchConversation(db, conversation.id, patch);

  return json({
    conversation: publicConversation({ ...conversation, ...patch }),
    messages,
    reply: { handoffSuggested, quickReplies },
  });
}

export async function handleSupportHandoff(db, request) {
  const body = parse(supportTokenSchema, await readJson(request));
  const digest = await sha256Hex(body.token);
  const throttled = await limit(db, "support_handoff", digest);
  if (throttled) return throttled;

  const conversation = await findByToken(db, body.token);
  if (conversation.status === "resolved") throw new AppError("conversation_closed", 409);
  if (conversation.status === "waiting" || conversation.status === "open") {
    return json({
      conversation: publicConversation(conversation),
      messages: await loadMessages(db, conversation.id),
    });
  }

  const locale = conversation.locale === "en" ? "en" : "bn";
  const message = await appendMessage(db, conversation.id, {
    authorType: "assistant",
    body: handoffMessage(locale),
    intent: "handoff",
    handoffSuggested: true,
  });
  const patch = {
    status: "waiting",
    last_message_at: message.createdAt,
    sla_due_at: laterIso(SLA_MS),
  };
  await patchConversation(db, conversation.id, patch);

  return json({
    conversation: publicConversation({ ...conversation, ...patch }),
    messages: await loadMessages(db, conversation.id),
  });
}

export async function handleSupportFaq(db, request) {
  const query = parse(
    supportFaqQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const lang = query.locale === "en" ? "en" : "bn";
  const faqs = rows(
    await db
      .from("faq_entries")
      .select("id,question_bn,question_en,answer_bn,answer_en,category,sort_order,published")
      .limit(50),
  )
    .filter((row) => row.published !== false)
    .sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
    .slice(0, 6)
    .map((row) => ({
      id: row.id,
      category: row.category,
      question: lang === "en" ? row.question_en : row.question_bn,
      answer: lang === "en" ? row.answer_en : row.answer_bn,
    }));
  return json({ faqs });
}

// ---------------------------------------------------------------------------
// Staff inbox

export async function handleAdminSupportInbox(db, request) {
  const query = parse(
    adminSupportQuerySchema,
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const conversations = rows(
    await db.from("support_conversations").select(CONVERSATION_COLUMNS).limit(200),
  );
  const messages = rows(
    await db.from("support_messages").select(MESSAGE_COLUMNS).limit(500),
  );
  const staff = await loadStaff(db);
  const staffMap = new Map(staff.map((member) => [member.id, member.name]));

  const grouped = new Map();
  for (const message of messages) {
    const list = grouped.get(message.conversation_id) ?? [];
    list.push(message);
    grouped.set(message.conversation_id, list);
  }

  const counts = { bot: 0, waiting: 0, open: 0, resolved: 0 };
  for (const row of conversations) {
    if (counts[row.status] !== undefined) counts[row.status] += 1;
  }

  const needle = query.q ? query.q.toLowerCase() : null;
  const items = conversations
    .filter((row) => !query.status || row.status === query.status)
    .filter((row) => {
      if (!needle) return true;
      return (
        String(row.customer_name).toLowerCase().includes(needle) ||
        String(row.customer_phone ?? "").includes(needle) ||
        String(row.order_number ?? "").toLowerCase().includes(needle) ||
        String(row.id).startsWith(needle)
      );
    })
    .map((row) => {
      const list = (grouped.get(row.id) ?? []).sort((left, right) =>
        String(left.created_at).localeCompare(String(right.created_at)),
      );
      const last = list[list.length - 1] ?? null;
      return {
        ...publicConversation(row),
        customerPhone: row.customer_phone ?? null,
        userId: row.user_id ?? null,
        assignedToId: row.assigned_to ?? null,
        assignedTo: staffMap.get(row.assigned_to) ?? null,
        messageCount: list.length,
        lastMessage: last
          ? { authorType: last.author_type, body: last.body, createdAt: last.created_at }
          : null,
        sla: slaState(row),
      };
    })
    .sort(
      (left, right) =>
        String(right.lastMessageAt).localeCompare(String(left.lastMessageAt)),
    );

  return json({
    conversations: items,
    counts,
    staff,
    canned: await loadCanned(db),
  });
}

export async function handleAdminSupportDetail(db, conversationId) {
  const conversation = await findById(db, conversationId);
  const messages = await loadMessages(db, conversation.id);
  const staff = await loadStaff(db);
  const staffMap = new Map(staff.map((member) => [member.id, member.name]));

  let order = null;
  if (conversation.order_number) {
    const found = rows(
      await db
        .from("orders")
        .select(
          "id,order_number,status,payment_status,payment_method,total_paisa,courier,tracking_number,created_at,customer_name,phone",
        )
        .eq("order_number", conversation.order_number)
        .limit(1),
    );
    if (found.length === 1) {
      const row = found[0];
      order = {
        id: row.id,
        orderNumber: row.order_number,
        status: row.status,
        paymentStatus: row.payment_status,
        paymentMethod: row.payment_method,
        totalPaisa: row.total_paisa,
        courier: row.courier ?? null,
        trackingNumber: row.tracking_number ?? null,
        customerName: row.customer_name,
        phone: row.phone,
        createdAt: row.created_at,
      };
    }
  }

  return json({
    conversation: {
      ...publicConversation(conversation),
      customerPhone: conversation.customer_phone ?? null,
      userId: conversation.user_id ?? null,
      assignedToId: conversation.assigned_to ?? null,
      assignedTo: staffMap.get(conversation.assigned_to) ?? null,
      sla: slaState(conversation),
    },
    messages: messages.map((message) => ({
      id: message.id,
      authorType: message.authorType,
      authorName:
        message.authorType === "customer"
          ? conversation.customer_name
          : message.authorType === "staff"
            ? staffMap.get(message.authorId) ?? null
            : null,
      body: message.body,
      intent: message.intent,
      handoffSuggested: message.handoffSuggested,
      createdAt: message.createdAt,
    })),
    order,
  });
}

export async function handleAdminSupportReply(db, request, principal, conversationId) {
  const throttled = await limit(db, "support_reply", principal.user.id);
  if (throttled) return throttled;

  const body = parse(adminSupportReplySchema, await readJson(request));
  const conversation = await findById(db, conversationId);

  let text = body.body;
  if (!text && body.cannedId) {
    const canned = rows(
      await db
        .from("support_canned_replies")
        .select("id,title,body")
        .eq("id", body.cannedId)
        .limit(1),
    );
    if (canned.length !== 1) throw new AppError("not_found", 404);
    text = canned[0].body;
  }
  if (!text) throw new AppError("invalid_input", 400);

  const message = await appendMessage(db, conversation.id, {
    authorType: "staff",
    authorId: principal.user.id,
    body: text,
  });
  const patch = { status: "open", last_message_at: message.createdAt };
  if (!conversation.first_response_at) patch.first_response_at = message.createdAt;
  await patchConversation(db, conversation.id, patch);

  await recordAudit(db, request, principal, {
    action: "support.reply",
    entityType: "support_conversation",
    entityId: conversation.id,
    summary: `Replied to ${conversation.customer_name}`,
    details: { orderNumber: conversation.order_number ?? null, body: message.body },
  });

  return handleAdminSupportDetail(db, conversation.id);
}

export async function handleAdminSupportAssign(db, request, principal, conversationId) {
  const body = parse(adminSupportAssignSchema, await readJson(request));
  const staff = await loadStaff(db);
  const assignee = staff.find((member) => member.id === body.assigneeId);
  if (!assignee) throw new AppError("invalid_assignee", 400);

  const conversation = await findById(db, conversationId);
  const patch = { assigned_to: assignee.id };
  if (conversation.status === "bot" || conversation.status === "waiting") {
    patch.status = "open";
  }
  await patchConversation(db, conversation.id, patch);

  await recordAudit(db, request, principal, {
    action: "support.assign",
    entityType: "support_conversation",
    entityId: conversation.id,
    summary: `Assigned chat to ${assignee.name}`,
    details: { assigneeId: assignee.id, orderNumber: conversation.order_number ?? null },
  });

  return handleAdminSupportDetail(db, conversation.id);
}

export async function handleAdminSupportClose(db, request, principal, conversationId) {
  const conversation = await findById(db, conversationId);
  if (conversation.status === "resolved") {
    return handleAdminSupportDetail(db, conversation.id);
  }

  const locale = conversation.locale === "en" ? "en" : "bn";
  const message = await appendMessage(db, conversation.id, {
    authorType: "system",
    body:
      locale === "en"
        ? "Support has closed this conversation. Start a new chat any time."
        : "সাপোর্ট টিম কথোপকথনটি বন্ধ করেছে। প্রয়োজনে নতুন চ্যাট শুরু করতে পারেন।",
  });
  const closedAt = message.createdAt;
  await patchConversation(db, conversation.id, {
    status: "resolved",
    closed_at: closedAt,
    last_message_at: closedAt,
  });

  await recordAudit(db, request, principal, {
    action: "support.close",
    entityType: "support_conversation",
    entityId: conversation.id,
    summary: `Closed chat with ${conversation.customer_name}`,
    details: { orderNumber: conversation.order_number ?? null },
  });

  return handleAdminSupportDetail(db, conversation.id);
}

export async function handleAdminCannedList(db) {
  return json({ canned: await loadCanned(db) });
}

export async function handleAdminCannedCreate(db, request, principal) {
  const body = parse(adminCannedCreateSchema, await readJson(request));
  const existing = rows(
    await db.from("support_canned_replies").select("sort_order").limit(100),
  );
  const position =
    existing.reduce((max, row) => Math.max(max, Number(row.sort_order) || 0), 0) + 1;
  const row = {
    id: crypto.randomUUID(),
    title: body.title,
    body: body.body,
    locale: body.locale,
    sort_order: position,
    created_by: principal.user.id,
    created_at: nowIso(),
  };
  const saved = rows(
    await db
      .from("support_canned_replies")
      .insertIfAbsent(row, { onConflict: "id" })
      .select("id"),
  );
  if (saved.length !== 1) throw new AppError("database_unavailable", 503);

  await recordAudit(db, request, principal, {
    action: "support.canned.create",
    entityType: "support_canned_reply",
    entityId: row.id,
    summary: `Created canned reply "${row.title}"`,
    details: { locale: row.locale },
  });

  return json({ canned: await loadCanned(db) }, 201);
}
