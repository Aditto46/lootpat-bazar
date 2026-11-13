import { ApiError, apiRequest } from "./api";

export type SupportStatus = "bot" | "waiting" | "open" | "resolved";
export type SupportLocale = "bn" | "en";
export type SupportAuthor = "customer" | "assistant" | "staff" | "system";

export type SupportMessage = {
  id: string;
  conversationId?: string;
  authorType: SupportAuthor;
  authorId?: string | null;
  authorName?: string | null;
  body: string;
  intent: string | null;
  handoffSuggested: boolean;
  createdAt: string;
};

export type SupportConversation = {
  id: string;
  status: SupportStatus;
  locale: SupportLocale;
  customerName: string;
  orderNumber: string | null;
  createdAt: string;
  lastMessageAt: string;
  slaDueAt: string | null;
  firstResponseAt: string | null;
  closedAt: string | null;
};

export type SupportFaq = {
  id: string;
  category: string;
  question: string;
  answer: string;
};

export type SupportSession = {
  conversation: SupportConversation;
  messages: SupportMessage[];
};

export type SupportStartInput = {
  name?: string;
  phone?: string;
  orderNumber?: string;
  message: string;
  locale: SupportLocale;
};

export type SupportStartResult = SupportSession & {
  token: string;
  quickReplies: string[];
};

export type SupportSendResult = SupportSession & {
  reply: { handoffSuggested: boolean; quickReplies: string[] };
};

export type SupportSla = {
  state: "ok" | "at-risk" | "overdue" | "answered" | "closed" | "none";
  minutesLeft: number | null;
};

export type SupportStaff = {
  id: string;
  name: string;
  role: { id: string; name_bn: string; name_en: string };
};

export type SupportCanned = {
  id: string;
  title: string;
  body: string;
  locale: SupportLocale;
  position: number;
  created_at: string;
};

export type AdminSupportItem = SupportConversation & {
  customerPhone: string | null;
  userId: string | null;
  assignedToId: string | null;
  assignedTo: string | null;
  messageCount: number;
  lastMessage: { authorType: SupportAuthor; body: string; createdAt: string } | null;
  sla: SupportSla;
};

export type AdminSupportInbox = {
  conversations: AdminSupportItem[];
  counts: Record<SupportStatus, number>;
  staff: SupportStaff[];
  canned: SupportCanned[];
};

export type AdminSupportOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalPaisa: number;
  courier: string | null;
  trackingNumber: string | null;
  customerName: string;
  phone: string;
  createdAt: string;
};

export type AdminSupportDetail = {
  conversation: SupportConversation & {
    customerPhone: string | null;
    userId: string | null;
    assignedToId: string | null;
    assignedTo: string | null;
    sla: SupportSla;
  };
  messages: SupportMessage[];
  order: AdminSupportOrder | null;
};

export const SUPPORT_PHONE = "+8801410286822";
export const SUPPORT_PHONE_DISPLAY = "+880 1410-286822";
export const SUPPORT_WHATSAPP = "https://wa.me/8801410286822";

export function startSupportChat(input: SupportStartInput): Promise<SupportStartResult> {
  return apiRequest<SupportStartResult>("/api/support/start", {
    method: "POST",
    body: {
      locale: input.locale,
      message: input.message,
      ...(input.name ? { name: input.name } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.orderNumber ? { orderNumber: input.orderNumber } : {}),
    },
  });
}

export function loadSupportSession(token: string): Promise<SupportSession> {
  return apiRequest<SupportSession>("/api/support/session", {
    method: "POST",
    body: { token },
  });
}

export function sendSupportMessage(
  token: string,
  message: string,
  locale: SupportLocale,
): Promise<SupportSendResult> {
  return apiRequest<SupportSendResult>("/api/support/messages", {
    method: "POST",
    body: { token, message, locale },
  });
}

export function requestSupportHandoff(token: string): Promise<SupportSession> {
  return apiRequest<SupportSession>("/api/support/handoff", {
    method: "POST",
    body: { token },
  });
}

export function loadSupportFaq(locale: SupportLocale): Promise<{ faqs: SupportFaq[] }> {
  return apiRequest<{ faqs: SupportFaq[] }>(`/api/support/faq?locale=${locale}`);
}

export function loadAdminSupport(params: {
  status?: SupportStatus;
  q?: string;
}): Promise<AdminSupportInbox> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.q) search.set("q", params.q);
  const query = search.toString();
  return apiRequest<AdminSupportInbox>(`/api/admin/support${query ? `?${query}` : ""}`);
}

export function loadAdminSupportDetail(id: string): Promise<AdminSupportDetail> {
  return apiRequest<AdminSupportDetail>(`/api/admin/support/${id}`);
}

export function replyToSupportChat(
  id: string,
  body: { body?: string; cannedId?: string },
): Promise<AdminSupportDetail> {
  return apiRequest<AdminSupportDetail>(`/api/admin/support/${id}/reply`, {
    method: "POST",
    body,
  });
}

export function assignSupportChat(id: string, assigneeId: string): Promise<AdminSupportDetail> {
  return apiRequest<AdminSupportDetail>(`/api/admin/support/${id}/assign`, {
    method: "POST",
    body: { assigneeId },
  });
}

export function closeSupportChat(id: string): Promise<AdminSupportDetail> {
  return apiRequest<AdminSupportDetail>(`/api/admin/support/${id}/close`, {
    method: "POST",
  });
}

export function createCannedReply(input: {
  title: string;
  body: string;
  locale: SupportLocale;
}): Promise<{ canned: SupportCanned[] }> {
  return apiRequest<{ canned: SupportCanned[] }>("/api/admin/support/canned", {
    method: "POST",
    body: input,
  });
}

export function isConversationClosed(error: unknown): boolean {
  return error instanceof ApiError && error.code === "conversation_closed";
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.code === "rate_limited";
}
