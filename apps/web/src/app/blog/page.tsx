import type { Metadata } from "next";
import Link from "next/link";
import { BasePage } from "@/app/base-page";
import { Separator } from "@/components/ui/separator";
import { BRAND, SHORT_DESCRIPTION } from "@/site/brand";
import { getPosts } from "@/blog/query";
import type { Post } from "@/blog/types";

export const metadata: Metadata = {
	title: "Blog",
	description: `News, updates, and caption-creation guides from ${BRAND.productName}.`,
	openGraph: {
		title: `Blog — ${BRAND.productName}`,
		description: `News, updates, and caption-creation guides from ${BRAND.productName}.`,
		type: "website",
	},
};

export default async function BlogPage() {
	const data = await getPosts().catch(() => null);
	if (!data || !data.posts) return <div>No posts yet</div>;

	return (
		<BasePage
			title="Blog"
			description={`News, updates, and caption-creation guides from ${BRAND.productName}.`}
		>
			<div className="flex flex-col">
				{data.posts.map((post) => (
					<div key={post.id} className="flex flex-col">
						<BlogPostItem post={post} />
						<Separator />
					</div>
				))}
			</div>
		</BasePage>
	);
}

function BlogPostItem({ post }: { post: Post }) {
	return (
		<Link href={`/blog/${post.slug}`}>
			<div className="flex h-auto w-full items-center justify-between py-6 opacity-100 hover:opacity-75">
				<div className="flex flex-col gap-2">
					<h2 className="text-xl font-semibold">{post.title}</h2>
					<p className="text-muted-foreground">{post.description}</p>
				</div>
			</div>
		</Link>
	);
}
