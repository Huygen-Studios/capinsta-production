declare module "content-collections" {
	type Changelog = import("@content-collections/core").GetTypeByName<
		typeof import("../../content-collections").default,
		"changelog"
	>;

	export const allChangelogs: Changelog[];
}
