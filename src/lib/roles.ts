export const assignableRoles = [
  { id: "admin", name_bn: "অ্যাডমিন", name_en: "Admin" },
  { id: "manager", name_bn: "ম্যানেজার", name_en: "Manager" },
  { id: "staff", name_bn: "স্টাফ", name_en: "Staff" },
  { id: "viewer", name_bn: "ভিউয়ার", name_en: "Viewer" },
] as const;

export type AssignableRoleId = (typeof assignableRoles)[number]["id"];
