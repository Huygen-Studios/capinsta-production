"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { EditorCore } from "@/core";
import { MigrationDialog } from "@/project/components/migration-dialog";
import { StoragePersistenceDialog } from "@/services/storage/components/storage-persistence-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useEditor } from "@/editor/use-editor";
import { useProjectsStore } from "./store";
import type {
	TProjectMetadata,
	TProjectSortKey,
	TProjectSortOption,
} from "@/project/types";
import { formatProjectDurationTicks } from "@/project/duration-format";
import { formatDate } from "@/utils/date";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
	Calendar04Icon,
	GridViewIcon,
	LeftToRightListDashIcon,
	PlusSignIcon,
	Search01Icon,
	Video01Icon,
	MoreHorizontalIcon,
	Delete02Icon,
	Copy01Icon,
	Edit03Icon,
	ArrowDown02Icon,
	InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { OcVideoIcon } from "@/components/icons";
import { Label } from "@/components/ui/label";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteProjectDialog } from "@/project/components/delete-project-dialog";
import { ProjectInfoDialog } from "@/project/components/project-info-dialog";
import { RenameProjectDialog } from "@/project/components/rename-project-dialog";
import { cn } from "@/utils/ui";
import { ChangelogNotification } from "@/changelog/components/changelog-notification";
import { useExpiredProjectCleanup } from "@/capinsta/useExpiredProjectCleanup";
import { AccountMenu } from "@/components/auth/account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { LogoStatic } from "@/components/logo";
import { storageService } from "@/services/storage/service";
import { ProjectsOnboardingCard } from "@/components/onboarding/projects-onboarding-card";
import { PostEditorRatingModal } from "@/components/feedback/post-editor-rating-modal";

const formatProjectDuration = ({
	duration,
}: {
	duration: number | undefined;
}): string | null => {
	return formatProjectDurationTicks({ duration });
};

const VIEW_MODE_OPTIONS = [
	{ mode: "grid" as const, icon: GridViewIcon, label: "Grid view" },
	{ mode: "list" as const, icon: LeftToRightListDashIcon, label: "List view" },
];

const PROJECT_ACCENTS = [
	"var(--neo-pink)",
	"var(--neo-blue)",
	"var(--neo-teal)",
	"var(--neo-yellow)",
	"var(--neo-coral)",
] as const;

function projectAccent(projectId: string): string {
	const total = Array.from(projectId).reduce(
		(sum, char) => sum + char.charCodeAt(0),
		0,
	);
	return PROJECT_ACCENTS[total % PROJECT_ACCENTS.length] ?? PROJECT_ACCENTS[0];
}

function formatBytes(bytes: number): string {
	if (bytes <= 0) return "0 MB";
	const mb = bytes / (1024 * 1024);
	if (mb < 1024) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
	return `${(mb / 1024).toFixed(2)} GB`;
}

export default function ProjectsPage() {
	const { searchQuery, sortKey, sortOrder, viewMode } = useProjectsStore();
	const editor = useEditor();
	const sortOption: TProjectSortOption = `${sortKey}-${sortOrder}`;

	const isLoading = useEditor((e) => e.project.getIsLoading());
	const isInitialized = useEditor((e) => e.project.getIsInitialized());
	const projectsToDisplay = useEditor((e) =>
		e.project.getFilteredAndSortedProjects({ searchQuery, sortOption }),
	);
	useExpiredProjectCleanup({ enabled: isInitialized });

	useEffect(() => {
		if (!editor.project.getIsInitialized()) {
			editor.project.loadAllProjects();
		}
	}, [editor.project]);

	return (
		<div className="projects-shell min-h-screen bg-background text-foreground">
			<PostEditorRatingModal />
			<MigrationDialog />
			<StoragePersistenceDialog />
			<ChangelogNotification />
			<ProjectsHeader />
			<ProjectsToolbar projectIds={projectsToDisplay.map((p) => p.id)} />
			<main className="mx-auto flex max-w-[1800px] flex-col gap-4 px-4 pb-8 pt-3">
				{isLoading || !isInitialized ? (
					<ProjectsSkeleton />
				) : projectsToDisplay.length === 0 ? (
					<EmptyState />
				) : (
					<div
						className={
							viewMode === "grid"
								? "xs:grid-cols-2 grid grid-cols-1 gap-5 px-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5"
								: "flex flex-col gap-2 px-2"
						}
					>
						{projectsToDisplay.map((project) => (
							<ProjectItem
								key={project.id}
								project={project}
								allProjectIds={projectsToDisplay.map((p) => p.id)}
							/>
						))}
					</div>
				)}
			</main>
		</div>
	);
}

function ProjectsHeader() {
	const { viewMode, isHydrated, setViewMode } = useProjectsStore();

	return (
		<header className="sticky top-0 z-20 flex flex-col gap-2 border-b-2 border-border bg-card px-4 shadow-[0_3px_0_var(--shadow-strong)] sm:px-8">
			<div className="flex items-center justify-between h-16 pt-2">
				<div className="flex min-w-0 items-center gap-4">
					<Link href="/" aria-label="Capinsta home" className="hidden sm:block">
						<LogoStatic variant="mark" height={28} alt="Capinsta" priority />
					</Link>
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink asChild>
									<Link href="/" className="text-sm sm:text-base">
										Home
									</Link>
								</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage className="text-sm sm:text-base font-medium">
									All projects
								</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>

					<h1 className="hidden text-2xl font-black tracking-tight lg:block">
						Projects
					</h1>

					<div className="hidden h-10 items-center gap-1 rounded-sm border-2 border-border bg-muted/60 p-1 shadow-[2px_2px_0_var(--shadow-strong)] md:flex">
						{VIEW_MODE_OPTIONS.map(({ mode, icon, label }) => (
							<Button
								key={mode}
								variant="ghost"
								size="icon"
								className={cn(
									"size-8 rounded-xs border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
									isHydrated &&
										viewMode === mode &&
										"border-[var(--neo-black)] bg-primary text-primary-foreground shadow-[2px_2px_0_var(--shadow-strong)] hover:bg-primary hover:text-primary-foreground",
								)}
								onClick={() => setViewMode({ viewMode: mode })}
								aria-label={label}
								aria-pressed={isHydrated && viewMode === mode}
							>
								<HugeiconsIcon icon={icon} className="size-4" />
							</Button>
						))}
					</div>
				</div>

				<div className="flex items-center gap-3 md:gap-4">
					<SearchBar className="hidden md:block" />
					<NewProjectButton />
					<ThemeToggle />
					<AccountMenu compact />
				</div>
			</div>
			<SearchBar className="block md:hidden mb-4" />
		</header>
	);
}

const SORT_LABELS: Record<TProjectSortKey, string> = {
	createdAt: "Created",
	updatedAt: "Modified",
	name: "Name",
	duration: "Duration",
};

function ProjectsToolbar({ projectIds }: { projectIds: string[] }) {
	const [isRecoveringStorage, setIsRecoveringStorage] = useState(false);
	const {
		selectedProjectIds,
		sortKey,
		sortOrder,
		setSortOrder,
		setSelectedProjects,
		clearSelectedProjects,
		viewMode,
		setViewMode,
	} = useProjectsStore();

	const selectedProjectCount = selectedProjectIds.length;
	const isAllSelected =
		projectIds.length > 0 && selectedProjectCount === projectIds.length;
	const hasSomeSelected =
		selectedProjectCount > 0 && selectedProjectCount < projectIds.length;

	const handleSelectAll = ({ checked }: { checked: boolean }) => {
		if (checked) {
			setSelectedProjects({ projectIds });
			return;
		}
		clearSelectedProjects();
	};

	const handleRecoverStorage = async () => {
		setIsRecoveringStorage(true);
		try {
			const result = await storageService.recoverLegacyBrowserStorage();
			const message =
				result.requiresReimportProjects.length > 0
					? `Recovered ${formatBytes(result.reclaimedBytes)}. ${result.requiresReimportProjects.length} project(s) still need re-import because no verified backend media asset exists.`
					: `Recovered ${formatBytes(result.reclaimedBytes)} from duplicate browser video storage.`;
			toast.success("Storage recovery complete", {
				description: `${message} Estimated reclaimable: ${formatBytes(result.estimatedReclaimableBytes)}.`,
			});
			if (result.errors.length > 0) {
				toast.warning("Some storage entries could not be checked", {
					description: `${result.errors.length} scoped item(s) failed; no unverified local-only media was deleted.`,
				});
			}
		} catch (error) {
			toast.error("Storage recovery failed", {
				description:
					error instanceof Error
						? error.message
						: "Please retry after refreshing the page.",
			});
		} finally {
			setIsRecoveringStorage(false);
		}
	};

	return (
		<div className="sticky top-16 z-10 mx-4 flex h-14 items-center justify-between border-b-2 border-border bg-background px-2 pt-1">
			<div className="flex items-center gap-2">
				<Label
					className="flex items-center gap-3 cursor-pointer px-2"
					htmlFor="select-all-projects"
				>
					<Checkbox
						className="size-5"
						id="select-all-projects"
						checked={
							isAllSelected ? true : hasSomeSelected ? "indeterminate" : false
						}
						onCheckedChange={(checked) =>
							handleSelectAll({ checked: checked === true })
						}
					/>
					<span className="text-muted-foreground hidden md:block">
						Select all
					</span>
				</Label>

				<div className="h-5 w-px bg-border" />

				<SortDropdown>
					<Button variant="text" className="text-muted-foreground pl-2">
						{SORT_LABELS[sortKey]}
					</Button>
				</SortDropdown>
				<Button
					variant="text"
					className="text-muted-foreground"
					onClick={() =>
						setSortOrder({
							sortOrder: sortOrder === "asc" ? "desc" : "asc",
						})
					}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							setSortOrder({
								sortOrder: sortOrder === "asc" ? "desc" : "asc",
							});
						}
					}}
					aria-label={`Sort ${sortOrder === "asc" ? "ascending" : "descending"}`}
				>
					<HugeiconsIcon
						icon={ArrowDown02Icon}
						className={sortOrder === "asc" ? "rotate-180" : ""}
					/>
				</Button>

				<div className="h-4 w-px bg-border/50 block md:hidden" />

				<div className="flex md:hidden items-center gap-1 rounded-sm border border-border bg-muted/60 p-1">
					{VIEW_MODE_OPTIONS.map(({ mode, icon, label }) => (
						<Button
							key={mode}
							variant="ghost"
							size="icon"
							className={cn(
								"size-8 rounded-xs border border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground",
								viewMode === mode &&
									"border-[var(--neo-black)] bg-primary text-primary-foreground shadow-[2px_2px_0_var(--shadow-strong)] hover:bg-primary hover:text-primary-foreground",
							)}
							onClick={() => setViewMode({ viewMode: mode })}
							aria-label={label}
							aria-pressed={viewMode === mode}
						>
							<HugeiconsIcon icon={icon} />
						</Button>
					))}
				</div>
			</div>
			{selectedProjectCount > 0 ? (
				<ProjectActions />
			) : (
				<Button
					variant="outline"
					size="sm"
					onClick={handleRecoverStorage}
					disabled={isRecoveringStorage}
				>
					{isRecoveringStorage ? "Recovering…" : "Recover storage"}
				</Button>
			)}
		</div>
	);
}

function SearchBar({
	className,
	collapsed,
}: {
	className?: string;
	collapsed?: boolean;
}) {
	const { searchQuery, setSearchQuery } = useProjectsStore();

	return (
		<>
			{collapsed ? (
				<div className="block md:hidden">
					<Button
						size="icon"
						variant="outline"
						className="size-10.5 rounded-sm"
					>
						<HugeiconsIcon icon={Search01Icon} />
					</Button>
				</div>
			) : (
				<div className={cn("relative", className)}>
					<HugeiconsIcon
						icon={Search01Icon}
						className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2"
						aria-hidden="true"
					/>
					<Input
						placeholder="Search..."
						value={searchQuery}
						onChange={(event) => setSearchQuery({ query: event.target.value })}
						size="lg"
						className="h-10 min-w-56 rounded-sm border-2 bg-card pl-9 focus-visible:border-primary"
					/>
				</div>
			)}
		</>
	);
}

const PROJECT_ACTIONS = [
	{
		id: "duplicate",
		label: "Duplicate",
		icon: Copy01Icon,
		variant: "outline" as const,
	},
	{
		id: "delete",
		label: "Delete",
		icon: Delete02Icon,
		variant: "destructive-foreground" as const,
	},
] as const;

async function deleteProjects({
	editor,
	ids,
}: {
	editor: EditorCore;
	ids: string[];
}) {
	await editor.project.deleteProjects({ ids });
}

async function duplicateProjects({
	editor,
	ids,
}: {
	editor: EditorCore;
	ids: string[];
}) {
	await editor.project.duplicateProjects({ ids });
}

async function renameProject({
	editor,
	id,
	name,
}: {
	editor: EditorCore;
	id: string;
	name: string;
}) {
	await editor.project.renameProject({ id, name });
}

function ProjectActions() {
	const editor = useEditor();
	const { selectedProjectIds, clearSelectedProjects } = useProjectsStore();
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const savedProjects = editor.project.getSavedProjects();
	const selectedProjectNames = savedProjects
		.filter((project) => selectedProjectIds.includes(project.id))
		.map((project) => project.name);

	const handleDuplicate = async () => {
		await duplicateProjects({ editor, ids: selectedProjectIds });
		clearSelectedProjects();
	};

	const handleDeleteClick = () => {
		setIsDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = async () => {
		setIsDeleting(true);
		try {
			await deleteProjects({ editor, ids: selectedProjectIds });
			clearSelectedProjects();
			setIsDeleteDialogOpen(false);
		} finally {
			setIsDeleting(false);
		}
	};

	const actionHandlers: Record<string, () => void> = {
		duplicate: handleDuplicate,
		delete: handleDeleteClick,
	};

	return (
		<>
			<div className="flex items-center gap-2.5 px-3">
				<div className="hidden sm:flex items-center gap-2.5">
					{PROJECT_ACTIONS.map((action) => (
						<Button
							key={action.id}
							size="icon"
							variant={action.variant}
							className="size-9"
							onClick={actionHandlers[action.id]}
						>
							<HugeiconsIcon icon={action.icon} />
						</Button>
					))}
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild className="sm:hidden">
						<Button size="icon" variant="outline" className="size-9">
							<HugeiconsIcon icon={MoreHorizontalIcon} />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{PROJECT_ACTIONS.map((action) => (
							<DropdownMenuItem
								key={action.id}
								variant={action.id === "delete" ? "destructive" : undefined}
								onClick={actionHandlers[action.id]}
							>
								<HugeiconsIcon icon={action.icon} />
								{action.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<DeleteProjectDialog
				isOpen={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
				projectNames={selectedProjectNames}
				onConfirm={handleDeleteConfirm}
				isDeleting={isDeleting}
			/>
		</>
	);
}

function SortDropdown({ children }: { children: React.ReactNode }) {
	const { sortKey, setSortKey } = useProjectsStore();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent className="w-48" align="center">
				<DropdownMenuCheckboxItem
					checked={sortKey === "createdAt"}
					onCheckedChange={() => setSortKey({ sortKey: "createdAt" })}
				>
					Created
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={sortKey === "updatedAt"}
					onCheckedChange={() => setSortKey({ sortKey: "updatedAt" })}
				>
					Modified
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={sortKey === "name"}
					onCheckedChange={() => setSortKey({ sortKey: "name" })}
				>
					Name
				</DropdownMenuCheckboxItem>
				<DropdownMenuCheckboxItem
					checked={sortKey === "duration"}
					onCheckedChange={() => setSortKey({ sortKey: "duration" })}
				>
					Duration
				</DropdownMenuCheckboxItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function NewProjectButton() {
	const editor = useEditor();
	const router = useRouter();

	const handleCreateProject = async () => {
		const projectId = await editor.project.createNewProject({
			name: "New project",
		});
		router.push(`/editor/${projectId}`);
	};

	return (
		<Button
			size="lg"
			variant="lime"
			className="flex px-5 font-black md:px-6"
			onClick={handleCreateProject}
		>
			<span className="text-sm font-medium hidden md:block">New project</span>
			<span className="text-sm font-medium block md:hidden">New</span>
		</Button>
	);
}

function ProjectItem({
	project,
	allProjectIds,
}: {
	project: TProjectMetadata;
	allProjectIds: string[];
}) {
	const {
		selectedProjectIds,
		viewMode,
		setProjectSelected,
		selectProjectRange,
	} = useProjectsStore();
	const selectedProjectIdSet = new Set(selectedProjectIds);
	const isSelected = selectedProjectIdSet.has(project.id);
	const selectedProjectCount = selectedProjectIds.length;
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);
	const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
	const editor = useEditor();
	const durationLabel = formatProjectDuration({ duration: project.duration });
	const isMultiSelect = selectedProjectCount > 1;
	const isGridView = viewMode === "grid";

	const handleRename = () => setIsRenameDialogOpen(true);
	const handleDuplicate = async () => {
		await duplicateProjects({ editor, ids: [project.id] });
	};
	const handleDeleteClick = () => setIsDeleteDialogOpen(true);
	const handleInfoClick = () => setIsInfoDialogOpen(true);
	const handleDeleteConfirm = async () => {
		setIsDeleting(true);
		try {
			await deleteProjects({ editor, ids: [project.id] });
			setIsDeleteDialogOpen(false);
		} finally {
			setIsDeleting(false);
		}
	};

	const handleCheckboxChange = ({
		checked,
		shiftKey,
	}: {
		checked: boolean;
		shiftKey: boolean;
	}) => {
		if (shiftKey && checked) {
			selectProjectRange({ projectId: project.id, allProjectIds });
			return;
		}
		setProjectSelected({ projectId: project.id, isSelected: checked });
	};

	const accent = projectAccent(project.id);
	const gridContent = (
		<Card
			className="project-card overflow-hidden rounded-sm border-2 border-border bg-card p-0 shadow-[4px_4px_0_var(--shadow-strong)] transition-[transform,box-shadow,border-color] duration-150 group-hover:-translate-y-1 group-hover:border-primary group-hover:shadow-[6px_6px_0_var(--shadow-strong)] group-focus-within:border-primary"
			style={{ borderTopColor: accent, borderTopWidth: 8 }}
		>
			<div className="relative aspect-video border-b-2 border-border bg-muted">
				<div className="absolute inset-0">
					{project.thumbnail ? (
						<Image
							src={project.thumbnail}
							alt="Project thumbnail"
							fill
							className="object-cover"
						/>
					) : (
						<div className="flex size-full items-center justify-center">
							<OcVideoIcon className="text-muted-foreground size-12 shrink-0" />
						</div>
					)}
				</div>

				{durationLabel && (
					<div className="absolute bottom-2 right-2 rounded-sm border border-[var(--neo-black)] bg-[var(--neo-black)] px-2 py-1 text-xs font-bold text-[#F7F3EA]">
						{durationLabel}
					</div>
				)}
			</div>

			<CardContent className="flex min-h-24 flex-col gap-2 px-4 py-3">
				<h3 className="group-hover:text-foreground/90 line-clamp-2 text-sm font-black leading-snug">
					{project.name}
				</h3>
				<div className="text-muted-foreground flex items-center gap-1.5 text-xs">
					<HugeiconsIcon icon={Calendar04Icon} className="size-4" />
					<span>Created {formatDate({ date: project.createdAt })}</span>
				</div>
			</CardContent>
		</Card>
	);

	const listRowContent = (
		<div className="flex items-center gap-3 flex-1 min-w-0">
			<div className="bg-muted relative size-10 rounded-sm overflow-hidden shrink-0">
				{project.thumbnail ? (
					<Image
						src={project.thumbnail}
						alt="Project thumbnail"
						fill
						className="object-cover"
					/>
				) : (
					<div className="flex size-full items-center justify-center">
						<OcVideoIcon className="text-muted-foreground size-5 shrink-0" />
					</div>
				)}
			</div>

			<h3 className="group-hover:text-foreground/90 text-sm font-medium truncate flex-1 min-w-0">
				{project.name}
			</h3>

			<span className="text-muted-foreground text-sm shrink-0 hidden sm:block">
				{durationLabel ?? "—"}
			</span>

			<span className="text-muted-foreground text-sm shrink-0 w-auto pl-8 text-right hidden xs:block">
				{formatDate({ date: project.createdAt })}
			</span>
		</div>
	);

	const listContent = (
		<div
			className={`flex items-center gap-4 rounded-sm border-2 px-4 py-2.5 transition-colors ${
				isSelected
					? "border-primary bg-primary/15 shadow-[2px_2px_0_var(--shadow-strong)]"
					: "border-border bg-card hover:border-primary/60 hover:bg-accent/40"
			}`}
			style={{ borderLeftColor: accent, borderLeftWidth: 8 }}
		>
			<Checkbox
				checked={isSelected}
				onMouseDown={(event) => event.preventDefault()}
				onClick={(event) => {
					handleCheckboxChange({
						checked: !isSelected,
						shiftKey: event.shiftKey,
					});
				}}
				onCheckedChange={() => {}}
				className="size-5 shrink-0"
			/>

			<Link href={`/editor/${project.id}`} className="flex-1 min-w-0">
				{listRowContent}
			</Link>

			{!isMultiSelect && (
				<ProjectMenu
					isOpen={isDropdownOpen}
					onOpenChange={setIsDropdownOpen}
					variant="list"
					onRenameClick={handleRename}
					onDuplicateClick={handleDuplicate}
					onDeleteClick={handleDeleteClick}
					onInfoClick={handleInfoClick}
				/>
			)}
		</div>
	);

	return (
		<>
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div
						className={cn(
							"group relative rounded-lg outline-none",
							isSelected && isGridView && "ring-2 ring-primary ring-offset-2 ring-offset-background",
						)}
					>
						{isGridView ? (
							<>
								<Link
									href={`/editor/${project.id}`}
									className="block rounded-lg focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary"
								>
									{gridContent}
								</Link>

								<Checkbox
									checked={isSelected}
									onMouseDown={(event) => event.preventDefault()}
									onClick={(event) => {
										handleCheckboxChange({
											checked: !isSelected,
											shiftKey: event.shiftKey,
										});
									}}
									onCheckedChange={() => {}}
									className={`absolute z-10 size-5 top-3 left-3 ${
										isSelected || isDropdownOpen
											? "opacity-100"
											: "opacity-0 group-hover:opacity-100"
									}`}
								/>

								{!isMultiSelect && (
									<ProjectMenu
										isOpen={isDropdownOpen}
										onOpenChange={setIsDropdownOpen}
										onRenameClick={handleRename}
										onDuplicateClick={handleDuplicate}
										onDeleteClick={handleDeleteClick}
										onInfoClick={handleInfoClick}
									/>
								)}
							</>
						) : (
							listContent
						)}
					</div>
				</ContextMenuTrigger>
				<ProjectContextMenuContent
					onRenameClick={handleRename}
					onDuplicateClick={handleDuplicate}
					onDeleteClick={handleDeleteClick}
					onInfoClick={handleInfoClick}
				/>
			</ContextMenu>

			<RenameProjectDialog
				isOpen={isRenameDialogOpen}
				onOpenChange={setIsRenameDialogOpen}
				projectName={project.name}
				onConfirm={async (newName) => {
					await renameProject({ editor, id: project.id, name: newName });
					setIsRenameDialogOpen(false);
				}}
			/>

			<DeleteProjectDialog
				isOpen={isDeleteDialogOpen}
				onOpenChange={setIsDeleteDialogOpen}
				projectNames={[project.name]}
				onConfirm={handleDeleteConfirm}
				isDeleting={isDeleting}
			/>

			<ProjectInfoDialog
				isOpen={isInfoDialogOpen}
				onOpenChange={setIsInfoDialogOpen}
				project={project}
			/>
		</>
	);
}

function ProjectContextMenuContent({
	onRenameClick,
	onDuplicateClick,
	onDeleteClick,
	onInfoClick,
}: {
	onRenameClick: () => void;
	onDuplicateClick: () => void;
	onDeleteClick: () => void;
	onInfoClick: () => void;
}) {
	return (
		<ContextMenuContent>
			<ContextMenuItem
				icon={<HugeiconsIcon icon={Edit03Icon} />}
				onClick={onRenameClick}
			>
				Rename
			</ContextMenuItem>
			<ContextMenuItem
				icon={<HugeiconsIcon icon={Copy01Icon} />}
				onClick={onDuplicateClick}
			>
				Duplicate
			</ContextMenuItem>
			<ContextMenuItem
				icon={<HugeiconsIcon icon={InformationCircleIcon} />}
				onClick={onInfoClick}
			>
				Info
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem
				variant="destructive"
				icon={<HugeiconsIcon icon={Delete02Icon} />}
				onClick={onDeleteClick}
			>
				Delete
			</ContextMenuItem>
		</ContextMenuContent>
	);
}

function ProjectMenu({
	isOpen,
	onOpenChange,
	variant = "grid",
	onRenameClick,
	onDuplicateClick,
	onDeleteClick,
	onInfoClick,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	variant?: "grid" | "list";
	onRenameClick: () => void;
	onDuplicateClick: () => void;
	onDeleteClick: () => void;
	onInfoClick: () => void;
}) {
	const handleRename = () => {
		onRenameClick();
		onOpenChange(false);
	};

	const handleDuplicate = () => {
		onDuplicateClick();
		onOpenChange(false);
	};

	const handleDeleteClick = () => {
		onDeleteClick();
		onOpenChange(false);
	};

	const handleInfoClick = () => {
		onInfoClick();
		onOpenChange(false);
	};

	const isGrid = variant === "grid";

	return (
		<DropdownMenu open={isOpen} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="background"
					className={
						isGrid
							? `absolute z-10 top-3 right-3 ${isOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`
							: "!bg-transparent !shadow-none"
					}
					size="icon"
					aria-label="Project menu"
					onClick={(event) => {
						event.preventDefault();
						event.stopPropagation();
					}}
					onMouseDown={(event) => event.stopPropagation()}
					onKeyDown={(event) => {
						if (event.key !== "Enter" && event.key !== " ") return;
						event.preventDefault();
						event.stopPropagation();
					}}
				>
					<HugeiconsIcon
						icon={MoreHorizontalIcon}
						className="text-foreground"
						aria-hidden="true"
					/>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-48" align="end">
				<DropdownMenuItem onClick={handleRename}>
					<HugeiconsIcon icon={Edit03Icon} />
					Rename
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleDuplicate}>
					<HugeiconsIcon icon={Copy01Icon} />
					Duplicate
				</DropdownMenuItem>
				<DropdownMenuItem onClick={handleInfoClick}>
					<HugeiconsIcon icon={InformationCircleIcon} />
					Info
				</DropdownMenuItem>
				<DropdownMenuItem variant="destructive" onClick={handleDeleteClick}>
					<HugeiconsIcon icon={Delete02Icon} />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ProjectsSkeleton() {
	const skeletonIds = Array.from(
		{ length: 24 },
		(_, index) => `skeleton-${index}`,
	);

	return (
		<div className="xs:grid-cols-2 grid grid-cols-1 gap-5 px-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
			{skeletonIds.map((skeletonId) => (
				<Card
					key={skeletonId}
					className="overflow-hidden border-2 border-border bg-card p-0 shadow-[4px_4px_0_var(--shadow-strong)]"
				>
					<div className="bg-muted relative aspect-video">
						<div className="absolute inset-0">
							<Skeleton className="bg-muted/50 size-full" />
						</div>
					</div>
					<CardContent className="flex flex-col gap-2 px-0 pt-4">
						<Skeleton className="bg-muted/50 h-4 w-3/4" />
						<div className="text-muted-foreground flex items-center gap-1.5">
							<Skeleton className="bg-muted/50 size-4" />
							<Skeleton className="bg-muted/50 h-4 w-24" />
						</div>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

function EmptyState() {
	const { searchQuery, setSearchQuery } = useProjectsStore();
	const router = useRouter();
	const editor = useEditor();
	const savedProjects = editor.project.getSavedProjects();
	const [onboardingComplete, setOnboardingComplete] = useState(false);
	const completeOnboarding = useCallback(() => setOnboardingComplete(true), []);

	const handleCreateProject = async () => {
		try {
			const projectId = await editor.project.createNewProject({
				name: "New project",
			});
			router.push(`/editor/${projectId}`);
		} catch (error) {
			toast.error("Failed to create project", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
		}
	};

	if (savedProjects.length > 0) {
		return (
			<div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-5 rounded-sm border-2 border-border bg-card px-8 py-16 text-center shadow-[5px_5px_0_var(--shadow-strong)]">
				<div className="flex flex-col items-center gap-8">
					<HugeiconsIcon
						icon={Search01Icon}
						className="text-foreground size-16 bg-accent border rounded-sm p-4"
					/>
					<div className="flex flex-col items-center gap-3">
						<h3 className="text-lg font-medium">No results found</h3>
						<p className="text-muted-foreground max-w-md">
							Your search for &ldquo;{searchQuery}&rdquo; did not return any
							results.
						</p>
					</div>
				</div>
			<Button
					onClick={() => setSearchQuery({ query: "" })}
					variant="outline"
					size="lg"
				>
					Clear search
				</Button>
			</div>
		);
	}

	if (!onboardingComplete) return <ProjectsOnboardingCard onDone={completeOnboarding} />;
	return (
		<div className="mx-auto flex max-w-xl flex-col items-center justify-center gap-6 rounded-sm border-2 border-border bg-card px-8 py-16 text-center shadow-[5px_5px_0_var(--shadow-strong)]">
			<div className="flex flex-col items-center gap-2">
				<div className="bg-accent flex size-16 items-center justify-center rounded-sm border">
					<HugeiconsIcon
						icon={Video01Icon}
						className="text-foreground size-8"
					/>
				</div>
				<h3 className="text-lg font-medium">No projects yet</h3>
				<p className="text-muted-foreground max-w-md">
					Start creating your first project. Import media, edit, and export your
					videos. All privately.
				</p>
			</div>
			<Button size="lg" variant="lime" className="gap-2 font-black" onClick={handleCreateProject}>
				<HugeiconsIcon icon={PlusSignIcon} />
				Create your first project
			</Button>
		</div>
	);
}
