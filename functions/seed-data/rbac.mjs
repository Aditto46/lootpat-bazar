// Role and permission catalog. This matrix is the single source for both the
// seeded rows and the server-side checks; the UI only mirrors it.

export const PERMISSIONS = [
  { id: "products.read", description: "View products and catalog data" },
  { id: "products.write", description: "Create and edit products" },
  { id: "inventory.read", description: "View stock levels" },
  { id: "inventory.write", description: "Adjust stock levels" },
  { id: "orders.read", description: "View orders and customer details" },
  { id: "orders.write", description: "Update order status and fulfilment" },
  { id: "customers.read", description: "View customer profiles" },
  { id: "customers.write", description: "Edit customer profiles" },
  { id: "marketing.read", description: "View coupons, flash sales, spin prizes and campaigns" },
  { id: "marketing.write", description: "Create and edit coupons, flash sales, spin prizes, banners and campaigns" },
  { id: "reviews.read", description: "View customer reviews" },
  { id: "reviews.write", description: "Approve, reject and reply to customer reviews" },
  { id: "support.read", description: "Read support conversations" },
  { id: "support.write", description: "Reply to support conversations" },
  { id: "content.read", description: "View pages, banners and settings copy" },
  { id: "content.write", description: "Edit pages, banners and settings copy" },
  { id: "settings.read", description: "View store settings" },
  { id: "settings.write", description: "Edit store settings" },
  { id: "team.read", description: "View team members and roles" },
  { id: "team.write", description: "Invite staff and change roles (owner only)" },
  { id: "audit.read", description: "Read the audit log (owner only)" },
  { id: "data.export", description: "Export store data (owner only)" },
  { id: "data.delete", description: "Permanently delete data (owner only)" },
  { id: "payments.manage", description: "Manage payment keys and payouts (owner only)" },
];

export const ROLES = [
  { id: "owner", name_bn: "মালিক", name_en: "Owner", level: 100, is_staff: true },
  { id: "admin", name_bn: "অ্যাডমিন", name_en: "Admin", level: 80, is_staff: true },
  { id: "manager", name_bn: "ম্যানেজার", name_en: "Manager", level: 60, is_staff: true },
  { id: "staff", name_bn: "স্টাফ", name_en: "Staff", level: 40, is_staff: true },
  { id: "viewer", name_bn: "ভিউয়ার", name_en: "Viewer", level: 20, is_staff: true },
  { id: "customer", name_bn: "কাস্টমার", name_en: "Customer", level: 0, is_staff: false },
];

// Roles that can be assigned through the team screen. Ownership is transferred
// through a separate, audited path (Step 9), never by inviting a second owner.
export const ASSIGNABLE_ROLES = ["admin", "manager", "staff", "viewer"];

const READ_ONLY = PERMISSIONS
  .filter((permission) => permission.id.endsWith(".read"))
  .map((permission) => permission.id);

const OWNER_ONLY = ["audit.read", "data.export", "data.delete", "payments.manage", "team.write"];

export const ROLE_PERMISSIONS = {
  owner: PERMISSIONS.map((permission) => permission.id),
  admin: PERMISSIONS
    .map((permission) => permission.id)
    .filter((id) => !OWNER_ONLY.includes(id)),
  manager: [
    "products.read",
    "products.write",
    "inventory.read",
    "inventory.write",
    "orders.read",
    "orders.write",
    "customers.read",
    "marketing.read",
    "marketing.write",
    "reviews.read",
    "reviews.write",
    "support.read",
    "support.write",
    "content.read",
    "settings.read",
    "team.read",
  ],
  staff: [
    "products.read",
    "inventory.read",
    "orders.read",
    "orders.write",
    "customers.read",
    "reviews.read",
    "support.read",
    "support.write",
    "content.read",
  ],
  viewer: READ_ONLY,
  customer: [],
};
