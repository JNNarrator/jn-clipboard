export type AppCleanupPolicyAction = "ignore" | "clean";

export interface AppCleanupPolicy {
  id: string;
  enabled: boolean;
  appName: string;
  appPath: string;
  action: AppCleanupPolicyAction;
  contentTypes: string[];
  cleanupRules: string;
}

/** Every settings group starts collapsed each time the settings page opens. */
export const DEFAULT_COLLAPSED_GROUPS: Record<string, boolean> = {
  general: true,
  clipboard: true,
  appearance: true,
  cloud_sync: true,
  default_apps: true,
  secure_transfer: true,
  data: true
};
