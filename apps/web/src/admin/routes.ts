export const ADMIN_BASE_PATH = "/admincapinsta11";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) { return uuidPattern.test(value); }

export const adminRoutes = {
	module: (module: string) => `${ADMIN_BASE_PATH}/${encodeURIComponent(module)}`,
	detail: ({ module, id }: { module: string; id: string }) => `${ADMIN_BASE_PATH}/${encodeURIComponent(module)}/${encodeURIComponent(id)}`,
	userSecurity: ({ userId }: { userId: string }) => `${ADMIN_BASE_PATH}/security/users/${encodeURIComponent(userId)}`,
};
