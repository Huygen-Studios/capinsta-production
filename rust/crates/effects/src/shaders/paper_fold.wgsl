struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) tex_coord: vec2f,
}

struct EffectUniforms {
    resolution: vec2f,
    grid: vec2f,
    scalars: vec4f,
    tint: vec4f,
    appearance: vec4f,
    key_color: vec4f,
    keying: vec4f,
    detail: vec4f,
    paper_transform: vec4f,
    media_transform: vec4f,
    overall_transform: vec4f,
    composite: vec4f,
    shadow_color: vec4f,
    shadow: vec4f,
    border_color: vec4f,
    border: vec4f,
    unused: vec4f,
}

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(1) @binding(0) var<uniform> uniforms: EffectUniforms;
@group(2) @binding(0) var fold_atlas: texture_2d<f32>;
@group(2) @binding(1) var fold_sampler: sampler;

fn rotate_uv(uv: vec2f, radians: f32) -> vec2f {
    let centered = uv - vec2f(0.5);
    let sine = sin(radians);
    let cosine = cos(radians);
    return vec2f(
        centered.x * cosine - centered.y * sine,
        centered.x * sine + centered.y * cosine,
    ) + vec2f(0.5);
}

fn transform_uv(uv: vec2f, transform: vec4f) -> vec2f {
    let scale = max(0.001, transform.x);
    let positioned = uv - transform.zw;
    return rotate_uv((positioned - vec2f(0.5)) / scale + vec2f(0.5), -transform.y);
}

fn in_bounds(uv: vec2f) -> f32 {
    return select(0.0, 1.0, all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)));
}

fn atlas_uv(uv: vec2f, matte: bool) -> vec2f {
    let columns = max(1.0, uniforms.grid.x);
    let rows = max(1.0, uniforms.grid.y);
    let frame = clamp(uniforms.scalars.x, 0.0, columns * rows - 1.0);
    let column = frame % columns;
    let row = floor(frame / columns);
    let cell = vec2f(0.5 / columns, 1.0 / rows);
    let half_offset = select(0.0, 0.5, matte);
    return vec2f(half_offset + column * cell.x, row * cell.y) + clamp(uv, vec2f(0.0), vec2f(1.0)) * cell;
}

fn sample_matte(uv: vec2f) -> f32 {
    return textureSample(fold_atlas, fold_sampler, atlas_uv(uv, true)).r * in_bounds(uv);
}

fn hash(position: vec2f) -> f32 {
    return fract(sin(dot(position, vec2f(12.9898, 78.233))) * 43758.5453);
}

fn saturation(color: vec3f, amount: f32) -> vec3f {
    let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
    return mix(vec3f(luma), color, amount);
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
    let original = textureSample(source_texture, source_sampler, input.tex_coord);
    var effect_uv = transform_uv(input.tex_coord, uniforms.overall_transform);
    if (uniforms.composite.z > 0.5) { effect_uv.x = 1.0 - effect_uv.x; }
    if (uniforms.composite.w > 0.5) { effect_uv.y = 1.0 - effect_uv.y; }
    let media_uv = transform_uv(effect_uv, uniforms.media_transform);
    let paper_uv = transform_uv(effect_uv, uniforms.paper_transform);
    var source = textureSample(source_texture, source_sampler, clamp(media_uv, vec2f(0.0), vec2f(1.0)));
    source = source * in_bounds(media_uv);
    var source_rgb = source.rgb;
    var source_alpha = source.a;

    let alpha_mode = uniforms.keying.w;
    if (alpha_mode > 0.5 && alpha_mode < 1.5) {
        let luma = dot(source_rgb, vec3f(0.2126, 0.7152, 0.0722));
        source_alpha = source_alpha * luma;
    } else if (alpha_mode >= 1.5) {
        let distance_from_key = distance(source_rgb, uniforms.key_color.rgb);
        let keep = smoothstep(
            uniforms.keying.x,
            uniforms.keying.x + max(0.001, uniforms.keying.y),
            distance_from_key,
        );
        let dominance = max(0.0, source_rgb.g - max(source_rgb.r, source_rgb.b));
        source_rgb = vec3f(
            source_rgb.r,
            max(0.0, source_rgb.g - dominance * uniforms.keying.z * (1.0 - keep)),
            source_rgb.b,
        );
        source_alpha = source_alpha * keep;
    }
    let threshold = uniforms.detail.x;
    let feather = max(0.001, uniforms.detail.y);
    source_alpha = smoothstep(threshold - feather, threshold + feather, source_alpha);

    let matte = sample_matte(effect_uv) * uniforms.composite.y;
    source_alpha = source_alpha * matte * uniforms.key_color.a;
    source = vec4f(source_rgb * source_alpha, source_alpha);

    var paper = textureSample(fold_atlas, fold_sampler, atlas_uv(paper_uv, false)) * in_bounds(paper_uv);
    var paper_rgb = saturation(paper.rgb, uniforms.appearance.w);
    paper_rgb = (paper_rgb - vec3f(0.5)) * uniforms.appearance.z + vec3f(0.5);
    paper_rgb = paper_rgb * exp2(uniforms.appearance.y);
    paper_rgb = mix(paper_rgb, uniforms.tint.rgb, uniforms.tint.a);
    let grain = (hash(input.position.xy) - 0.5) * uniforms.detail.w;
    paper_rgb = paper_rgb + vec3f(grain);
    let dots = step(0.56, fract((input.position.x + input.position.y) * 0.18));
    paper_rgb = mix(paper_rgb, paper_rgb * (0.75 + dots * 0.25), uniforms.detail.z);
    let paper_alpha = paper.a * uniforms.appearance.x;
    paper = vec4f(paper_rgb * paper_alpha, paper_alpha);

    let pixel = vec2f(1.0) / uniforms.resolution;
    let border_radius = uniforms.border.x;
    let edge = max(
        abs(sample_matte(effect_uv + vec2f(pixel.x * border_radius, 0.0)) - matte),
        abs(sample_matte(effect_uv + vec2f(0.0, pixel.y * border_radius)) - matte),
    );
    let border = vec4f(uniforms.border_color.rgb * uniforms.border_color.a, uniforms.border_color.a) * edge * uniforms.border.y;

    let shadow_offset = vec2f(cos(uniforms.shadow.z), sin(uniforms.shadow.z)) * uniforms.shadow.y * pixel;
    let shadow_matte = sample_matte(effect_uv - shadow_offset);
    let shadow_alpha = max(0.0, shadow_matte - matte) * uniforms.shadow.x;
    let shadow = vec4f(uniforms.shadow_color.rgb * shadow_alpha, shadow_alpha);

    var processed = shadow + source * (1.0 - shadow.a);
    processed = border + processed * (1.0 - border.a);
    processed = paper + processed * (1.0 - paper.a);
    processed = processed * uniforms.composite.x;
    return mix(processed, original, uniforms.shadow.w);
}
