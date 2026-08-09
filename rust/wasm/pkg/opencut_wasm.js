/* @ts-self-types="./opencut_wasm.d.ts" */

import * as wasm from "./opencut_wasm_bg.wasm";
import { __wbg_set_wasm } from "./opencut_wasm_bg.js";
__wbg_set_wasm(wasm);
wasm.__wbindgen_start();
export {
    TICKS_PER_SECOND, activeCaptionState, applyEffectPasses, applyMaskFeather, canonicalizeCaptionDocument, editCaptionPageText, editCaptionPageTiming, exportCaptionSrt, exportCaptionVtt, floorToFrame, formatTimecode, getCompositorCanvas, getLastFrameProfile, guessTimecodeFormat, initCompositor, initializeGpu, isFrameAligned, lastFrameTime, mediaTimeAdd, mediaTimeClamp, mediaTimeFromFrame, mediaTimeFromSeconds, mediaTimeMax, mediaTimeMin, mediaTimeSub, mediaTimeToFrame, mediaTimeToSeconds, parseTimecode, rebuildCaptionPages, releaseTexture, renderFrame, resizeCompositor, resolvePaperFoldFrameState, roundToFrame, snappedSeekTime, uploadTexture, validateCaptionDocument, validatePaperFoldManifest
} from "./opencut_wasm_bg.js";
