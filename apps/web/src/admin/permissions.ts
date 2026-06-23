export const ADMIN_PERMISSIONS = [
  "users.read",
  "users.suspend",
  "users.restore",
  "users.export_data",
  "users.schedule_delete",
  "users.manage_roles",
  "projects.read",
  "projects.extend_retention",
  "projects.delete_temp_assets",
  "caption_jobs.read",
  "caption_jobs.cancel",
  "caption_jobs.retry",
  "caption_jobs.download_diagnostics",
  "exports.read",
  "exports.cancel",
  "exports.retry",
  "exports.delete_output",
  "feedback.read",
  "feedback.manage",
  "feedback.assign",
  "system.read",
  "system.manage_limits",
  "system.manage_providers",
  "feature_flags.read",
  "feature_flags.manage",
  "security.read",
  "security.unblock_ip",
  "security.reset_admin_mfa",
  "audit.read",
  "access.read",
  "access.manage_users",
  "access.manage_permissions",
  "access.manage_site_mode",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export function isAdminPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}

export const ROLE_PERMISSIONS: Record<string, readonly AdminPermission[]> = {
  super_admin: ADMIN_PERMISSIONS,
  operations: [
    "users.read",
    "projects.read",
    "projects.extend_retention",
    "projects.delete_temp_assets",
    "caption_jobs.read",
    "caption_jobs.cancel",
    "caption_jobs.retry",
    "caption_jobs.download_diagnostics",
    "exports.read",
    "exports.cancel",
    "exports.retry",
    "exports.delete_output",
    "system.read",
    "feature_flags.read",
    "access.read",
  ],
  support: [
    "users.read",
    "projects.read",
    "caption_jobs.read",
    "exports.read",
    "feedback.read",
    "feedback.manage",
    "feedback.assign",
  ],
  analyst: [
    "users.read",
    "projects.read",
    "caption_jobs.read",
    "exports.read",
    "feedback.read",
    "system.read",
    "feature_flags.read",
    "audit.read",
  ],
  content_manager: ["feature_flags.read", "feature_flags.manage"],
};

export const ADMIN_ROLES = [
  ["super_admin", "Super Admin", "Full administrative access."],
  ["operations", "Operations", "Operational job and system management."],
  ["support", "Support", "User and support case assistance."],
  ["analyst", "Analyst", "Read-only operational analytics."],
  [
    "content_manager",
    "Content Manager",
    "Approved content and preset configuration.",
  ],
] as const;
