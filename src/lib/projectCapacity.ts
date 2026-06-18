/** Soft per-project storage cap for the Files capacity bar. Env-overridable. */
export const PROJECT_CAPACITY_BYTES =
  Number(process.env.PROJECT_CAPACITY_BYTES) || 2 * 1024 * 1024 * 1024 // 2 GB
