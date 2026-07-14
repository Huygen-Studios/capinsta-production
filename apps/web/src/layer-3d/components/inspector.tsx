"use client";

import { useId, useState, type ReactNode } from "react";
import { Box, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
	Section,
	SectionContent,
	SectionHeader,
	SectionTitle,
} from "@/components/section";
import { useEditor } from "@/editor/use-editor";
import { useElementPreview } from "@/timeline/hooks/use-element-preview";
import type { GraphicElement, ImageElement, VideoElement } from "@/timeline";
import {
	LAYER_3D_PRESETS,
	createLayer3DEffect,
	normalizeLayer3DEffect,
	type Layer3DAnimation,
	type Layer3DCamera,
	type Layer3DEffect,
	type Layer3DLight,
	type Layer3DMaterial,
	type Layer3DPresetId,
	type Layer3DTransform,
} from "@/layer-3d";

export type Layer3DCompatibleElement =
	| VideoElement
	| ImageElement
	| GraphicElement;

export function Layer3DInspector({
	element,
	trackId,
}: {
	element: Layer3DCompatibleElement;
	trackId: string;
}) {
	const editor = useEditor();
	const [linkScale, setLinkScale] = useState(true);
	const { renderElement, previewUpdates, commit } = useElementPreview({
		trackId,
		elementId: element.id,
		fallback: element,
	});
	const effect = normalizeLayer3DEffect({ value: renderElement.layer3DEffect });

	const applyCommitted = ({ next }: { next: Layer3DEffect | undefined }) => {
		editor.timeline.updateElements({
			updates: [
				{ trackId, elementId: element.id, patch: { layer3DEffect: next } },
			],
		});
	};
	const preview = ({ next }: { next: Layer3DEffect }) =>
		previewUpdates({ layer3DEffect: next });
	const updateTransform = ({
		key,
		value,
	}: {
		key: keyof Layer3DTransform;
		value: number;
	}) => {
		if (!effect || key === "orientation") return;
		const transform = { ...effect.transform, [key]: value };
		if (linkScale && key === "scaleX") {
			transform.scaleY = value;
			transform.scaleZ = value;
		}
		preview({ next: { ...effect, transform } });
	};
	const updateCamera = ({
		key,
		value,
	}: {
		key: keyof Layer3DCamera;
		value: number;
	}) => {
		if (effect)
			preview({
				next: { ...effect, camera: { ...effect.camera, [key]: value } },
			});
	};
	const updateMaterial = ({
		key,
		value,
	}: {
		key: keyof Layer3DMaterial;
		value: number | boolean;
	}) => {
		if (effect)
			preview({
				next: { ...effect, material: { ...effect.material, [key]: value } },
			});
	};
	const updateLight = ({
		key,
		value,
	}: {
		key: keyof Layer3DLight;
		value: number | string | boolean;
	}) => {
		if (effect)
			preview({
				next: { ...effect, light: { ...effect.light, [key]: value } },
			});
	};
	const updateAnimation = ({
		key,
		value,
	}: {
		key: keyof Layer3DAnimation;
		value: number | string | boolean;
	}) => {
		if (effect)
			preview({
				next: { ...effect, animation: { ...effect.animation, [key]: value } },
			});
	};
	const updateOverride = ({ key, value }: { key: string; value: number }) => {
		if (effect)
			preview({
				next: {
					...effect,
					parameterOverrides: { ...effect.parameterOverrides, [key]: value },
				},
			});
	};

	if (!effect) {
		return (
			<div className="flex flex-col items-center gap-3 p-5 text-center">
				<Box className="size-8 text-muted-foreground" />
				<p className="text-sm text-muted-foreground">
					Apply a 3D Motion preset from the Effects panel.
				</p>
			</div>
		);
	}

	const preset = LAYER_3D_PRESETS.find(
		(candidate) => candidate.id === effect.presetId,
	);
	if (!preset) return null;
	const resetTransform = () =>
		preview({
			next: {
				...effect,
				transform: createLayer3DEffect({ presetId: effect.presetId }).transform,
			},
		});

	return (
		<div className="flex flex-col pb-4" data-testid="layer-3d-inspector">
			<InspectorSection title="3D Motion" defaultOpen>
				<label className="grid gap-1 text-xs">
					Preset
					<select
						className="h-9 rounded-sm border bg-background px-2"
						value={effect.presetId}
						onChange={(event) => {
							const presetId = parsePresetId({ value: event.target.value });
							if (presetId)
								applyCommitted({ next: createLayer3DEffect({ presetId }) });
						}}
					>
						{LAYER_3D_PRESETS.map((definition) => (
							<option key={definition.id} value={definition.id}>
								{definition.name}
							</option>
						))}
					</select>
				</label>
				<ToggleRow
					label="Enabled"
					checked={effect.enabled}
					onChange={(enabled) =>
						applyCommitted({ next: { ...effect, enabled } })
					}
				/>
				<NumberField
					label="Duration"
					value={effect.animation.duration}
					min={0.05}
					max={120}
					step={0.05}
					onChange={(value) => updateAnimation({ key: "duration", value })}
					onCommit={commit}
				/>
				<NumberField
					label="Delay"
					value={effect.animation.delay}
					min={0}
					max={120}
					step={0.05}
					onChange={(value) => updateAnimation({ key: "delay", value })}
					onCommit={commit}
				/>
				<NumberField
					label="Intensity"
					value={effect.animation.intensity}
					min={0}
					max={200}
					onChange={(value) => updateAnimation({ key: "intensity", value })}
					onCommit={commit}
				/>
				<label className="grid gap-1 text-xs">
					Direction
					<select
						className="h-9 rounded-sm border bg-background px-2"
						value={effect.animation.direction}
						onChange={(event) =>
							applyCommitted({
								next: {
									...effect,
									animation: {
										...effect.animation,
										direction:
											event.target.value === "reverse"
												? "reverse"
												: event.target.value === "alternate"
													? "alternate"
													: "forward",
									},
								},
							})
						}
					>
						<option value="forward">Forward</option>
						<option value="reverse">Reverse</option>
						<option value="alternate">Alternate</option>
					</select>
				</label>
				<label className="grid gap-1 text-xs">
					Easing
					<select
						className="h-9 rounded-sm border bg-background px-2"
						value={effect.animation.easing}
						onChange={(event) =>
							applyCommitted({
								next: {
									...effect,
									animation: {
										...effect.animation,
										easing: parseEasing({ value: event.target.value }),
									},
								},
							})
						}
					>
						<option value="smooth">Smooth</option>
						<option value="snappy">Snappy</option>
						<option value="overshoot">Overshoot</option>
						<option value="linear">Linear</option>
					</select>
				</label>
				<ToggleRow
					label="Loop"
					checked={effect.animation.loop}
					onChange={(loop) =>
						applyCommitted({
							next: { ...effect, animation: { ...effect.animation, loop } },
						})
					}
				/>
				{preset.parameters.map((parameter) => (
					<NumberField
						key={parameter.id}
						label={parameter.label}
						value={numberOverride({
							value: effect.parameterOverrides[parameter.id],
							fallback: parameter.min,
						})}
						min={parameter.min}
						max={parameter.max}
						step={parameter.step}
						onChange={(value) => updateOverride({ key: parameter.id, value })}
						onCommit={commit}
					/>
				))}
				{effect.presetId === "orbit-reveal" ? (
					<OverrideSelect
						label="Orbit direction"
						value={stringOverride({
							value: effect.parameterOverrides.orbitDirection,
							fallback: "left",
						})}
						options={["left", "right"]}
						onChange={(value) =>
							applyCommitted({
								next: {
									...effect,
									parameterOverrides: {
										...effect.parameterOverrides,
										orbitDirection: value,
									},
								},
							})
						}
					/>
				) : null}
				{effect.presetId === "light-sweep-hero" ? (
					<OverrideSelect
						label="Sweep direction"
						value={stringOverride({
							value: effect.parameterOverrides.sweepDirection,
							fallback: "right",
						})}
						options={["left", "right"]}
						onChange={(value) =>
							applyCommitted({
								next: {
									...effect,
									parameterOverrides: {
										...effect.parameterOverrides,
										sweepDirection: value,
									},
								},
							})
						}
					/>
				) : null}
			</InspectorSection>

			<InspectorSection title="Transform">
				{(
					[
						"positionX",
						"positionY",
						"positionZ",
						"anchorX",
						"anchorY",
						"anchorZ",
					] as const
				).map((key) => (
					<NumberField
						key={key}
						label={labelForKey(key)}
						value={effect.transform[key]}
						min={key.includes("Z") ? -2000 : -5000}
						max={key.includes("Z") ? 2000 : 5000}
						onChange={(value) => updateTransform({ key, value })}
						onCommit={commit}
					/>
				))}
				<ToggleRow
					label="Link scale axes"
					checked={linkScale}
					onChange={setLinkScale}
				/>
				{(["scaleX", "scaleY", "scaleZ"] as const).map((key) => (
					<NumberField
						key={key}
						label={labelForKey(key)}
						value={effect.transform[key]}
						min={1}
						max={500}
						onChange={(value) => updateTransform({ key, value })}
						onCommit={commit}
					/>
				))}
				{(["x", "y", "z", "w"] as const).map((key) => (
					<NumberField
						key={key}
						label={`Orientation ${key.toUpperCase()}`}
						value={effect.transform.orientation[key]}
						min={-1}
						max={1}
						step={0.01}
						onChange={(value) =>
							preview({
								next: {
									...effect,
									transform: {
										...effect.transform,
										orientation: {
											...effect.transform.orientation,
											[key]: value,
										},
									},
								},
							})
						}
						onCommit={commit}
					/>
				))}
				{(["rotationX", "rotationY", "rotationZ"] as const).map((key) => (
					<NumberField
						key={key}
						label={labelForKey(key)}
						value={effect.transform[key]}
						min={-360}
						max={360}
						step={0.1}
						onChange={(value) => updateTransform({ key, value })}
						onCommit={commit}
					/>
				))}
				<Button
					variant="secondary"
					onClick={() => {
						resetTransform();
						commit();
					}}
				>
					<RotateCcw />
					Reset Transform
				</Button>
			</InspectorSection>

			<InspectorSection title="Camera">
				{(
					[
						"perspective",
						"focalLength",
						"positionX",
						"positionY",
						"positionZ",
					] as const
				).map((key) => (
					<NumberField
						key={key}
						label={`Camera ${labelForKey(key)}`}
						value={effect.camera[key]}
						min={
							key === "perspective" ? 100 : key === "focalLength" ? 10 : -5000
						}
						max={
							key === "perspective" ? 5000 : key === "focalLength" ? 300 : 5000
						}
						onChange={(value) => updateCamera({ key, value })}
						onCommit={commit}
					/>
				))}
				<Button
					variant="secondary"
					onClick={() => {
						preview({
							next: {
								...effect,
								camera: createLayer3DEffect({ presetId: effect.presetId })
									.camera,
							},
						});
						commit();
					}}
				>
					<RotateCcw />
					Reset Camera
				</Button>
			</InspectorSection>

			<InspectorSection title="Light">
				<ToggleRow
					label="Enable Light"
					checked={effect.light.enabled}
					onChange={(enabled) =>
						applyCommitted({
							next: { ...effect, light: { ...effect.light, enabled } },
						})
					}
				/>
				<label className="grid gap-1 text-xs">
					Light Type
					<select
						className="h-9 rounded-sm border bg-background px-2"
						value={effect.light.type}
						onChange={(event) =>
							applyCommitted({
								next: {
									...effect,
									light: {
										...effect.light,
										type:
											event.target.value === "point" ? "point" : "directional",
									},
								},
							})
						}
					>
						<option value="directional">Directional</option>
						<option value="point">Point</option>
					</select>
				</label>
				<label className="flex items-center justify-between gap-2 text-xs">
					Light Color
					<input
						type="color"
						value={effect.light.color}
						onChange={(event) =>
							updateLight({
								key: "color",
								value: event.target.value.toUpperCase(),
							})
						}
						onBlur={commit}
					/>
				</label>
				{(["intensity", "positionX", "positionY", "positionZ"] as const).map(
					(key) => (
						<NumberField
							key={key}
							label={`Light ${labelForKey(key)}`}
							value={effect.light[key]}
							min={key === "intensity" ? 0 : -5000}
							max={key === "intensity" ? 100 : 5000}
							onChange={(value) => updateLight({ key, value })}
							onCommit={commit}
						/>
					),
				)}
				<Button
					variant="secondary"
					onClick={() => {
						preview({
							next: {
								...effect,
								light: createLayer3DEffect({ presetId: effect.presetId }).light,
							},
						});
						commit();
					}}
				>
					<RotateCcw />
					Reset Light
				</Button>
			</InspectorSection>

			<InspectorSection title="Material">
				<ToggleRow
					label="Accepts Lights"
					checked={effect.material.acceptsLights}
					onChange={(value) =>
						applyCommitted({
							next: {
								...effect,
								material: { ...effect.material, acceptsLights: value },
							},
						})
					}
				/>
				{(
					[
						"ambient",
						"diffuse",
						"specularIntensity",
						"specularShininess",
						"metallic",
					] as const
				).map((key) => (
					<NumberField
						key={key}
						label={labelForKey(key)}
						value={effect.material[key]}
						min={key === "specularShininess" ? 1 : 0}
						max={key === "specularShininess" ? 200 : 100}
						onChange={(value) => updateMaterial({ key, value })}
						onCommit={commit}
					/>
				))}
			</InspectorSection>

			<InspectorSection title="Shadow">
				<ToggleRow
					label="Casts Shadows"
					checked={effect.material.castsShadows}
					onChange={(value) =>
						applyCommitted({
							next: {
								...effect,
								material: { ...effect.material, castsShadows: value },
							},
						})
					}
				/>
				<ToggleRow
					label="Accepts Shadows"
					checked={effect.material.acceptsShadows}
					onChange={(value) =>
						applyCommitted({
							next: {
								...effect,
								material: { ...effect.material, acceptsShadows: value },
							},
						})
					}
				/>
				<NumberField
					label="Shadow Diffusion"
					value={effect.material.shadowDiffusion}
					min={0}
					max={100}
					onChange={(value) =>
						updateMaterial({ key: "shadowDiffusion", value })
					}
					onCommit={commit}
				/>
			</InspectorSection>

			<div className="grid gap-2 px-3 pt-3">
				<Button
					variant="secondary"
					onClick={() =>
						applyCommitted({
							next: createLayer3DEffect({ presetId: effect.presetId }),
						})
					}
				>
					<RotateCcw />
					Reset Preset
				</Button>
				<Button
					variant="destructive"
					onClick={() => applyCommitted({ next: undefined })}
				>
					<Trash2 />
					Remove 3D Effect
				</Button>
			</div>
		</div>
	);
}

function InspectorSection({
	title,
	children,
	defaultOpen = false,
}: {
	title: string;
	children: ReactNode;
	defaultOpen?: boolean;
}) {
	return (
		<Section
			collapsible
			defaultOpen={defaultOpen}
			sectionKey={`layer-3d:${title}`}
		>
			<SectionHeader>
				<SectionTitle>{title}</SectionTitle>
			</SectionHeader>
			<SectionContent className="grid gap-3 px-3 pb-4">
				{children}
			</SectionContent>
		</Section>
	);
}

function NumberField({
	label,
	value,
	min,
	max,
	step = 1,
	onChange,
	onCommit,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (value: number) => void;
	onCommit: () => void;
}) {
	const id = useId();
	return (
		<div className="grid gap-1">
			<label htmlFor={id} className="flex justify-between text-xs">
				<span>{label}</span>
				<span className="tabular-nums text-muted-foreground">
					{Number(value).toFixed(step < 1 ? 2 : 0)}
				</span>
			</label>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => onChange(Number(event.target.value))}
				onPointerUp={onCommit}
				onKeyUp={onCommit}
			/>
		</div>
	);
}

function ToggleRow({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-3 text-xs">
			<span>{label}</span>
			<Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
		</div>
	);
}

function OverrideSelect({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: readonly string[];
	onChange: (value: string) => void;
}) {
	const id = useId();
	return (
		<label className="grid gap-1 text-xs" htmlFor={id}>
			{label}
			<select
				id={id}
				className="h-9 rounded-sm border bg-background px-2"
				value={value}
				onChange={(event) => {
					if (options.includes(event.target.value))
						onChange(event.target.value);
				}}
			>
				{options.map((option) => (
					<option key={option} value={option}>
						{labelForKey(option)}
					</option>
				))}
			</select>
		</label>
	);
}

function labelForKey(key: string): string {
	return key
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (character) => character.toUpperCase());
}

function parsePresetId({ value }: { value: string }): Layer3DPresetId | null {
	const preset = LAYER_3D_PRESETS.find((candidate) => candidate.id === value);
	return preset?.id ?? null;
}

function parseEasing({ value }: { value: string }): string {
	return value === "linear" || value === "snappy" || value === "overshoot"
		? value
		: "smooth";
}

function numberOverride({
	value,
	fallback,
}: {
	value: Layer3DEffect["parameterOverrides"][string] | undefined;
	fallback: number;
}): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOverride({
	value,
	fallback,
}: {
	value: Layer3DEffect["parameterOverrides"][string] | undefined;
	fallback: string;
}): string {
	return typeof value === "string" ? value : fallback;
}
