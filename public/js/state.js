// js/state.js — 运行时可变状态 + mutator 函数集中地
// 跨模块共享的可变状态集中到这里,其他模块只能通过 mutator 函数修改。
// (ESM `export let` 是 binding 只读,跨模块 import 后直接赋值会 throw)
//
// 来源:A 阶段 ui-core.js:8-65 + ui-events.js / ui-modals.js / ui-fuse.js
//      / ui-mode.js / editor.js / generate.js 中所有 `window.xxx = ...` 的顶层状态

// ---- DOM refs(由 ui-core.js#attachCore 写入) ----
export let dom = {};

export function attachDomRefs(refs) {
    dom = { ...refs };
}

// ---- 运行时可变状态(顶层 let,整体重新赋值需走 mutator) ----
export let currentPalette = null;
export let currentPaletteId = 221;
export let currentImage = null;
export let tempCanvas = null;
export let tempCtx = null;
export let currentMode = 'grid'; // 'grid' | 'fused'
export let fuseEffect = 'plain'; // 'plain' | 'towel' | ...
export let pixelationMode = 'dominant'; // 'dominant' | 'alpha-weighted'
export let mergeThreshold = 0;
export let lastFileSize = 0;
export let lastMergedGrid = null;
export let lastPreMergeGrid = null;
export let lastCellSize = 0;
export let lastGridCols = 0;
export let lastGridRows = 0;
export let bgRemovalEnabled = false;
export let bgRemovalMode = 'auto'; // 'auto' | 'manual'
export let bgThreshold = 4;
export let bgManualPoints = []; // Array<{col: number, row: number}>
export let sampleMatchThr = 4;

// ---- 数组引用 ----
export const editorHistory = [];
export const editorFuture = [];
export let recentCodes = []; // 替换引用(mutator),不 mutate 内容
export const pickerActive = { current: null };

// ---- Mutator 函数 ----
export function setPalette(p, id = 221) {
    currentPalette = p;
    currentPaletteId = id;
}
export function setCurrentImage(img) {
    currentImage = img;
}
export function setTempCtx(canvas, ctx) {
    tempCanvas = canvas;
    tempCtx = ctx;
}
export function setMode(m) {
    currentMode = m;
}
export function setFuseEffect(e) {
    fuseEffect = e;
}
export function setPixelationMode(m) {
    pixelationMode = m;
}
export function setMergeThreshold(t) {
    mergeThreshold = t;
}
export function setLastFileSize(n) {
    lastFileSize = n;
}
export function setLastMergedGrid(g) {
    lastMergedGrid = g;
}
export function setLastPreMergeGrid(g) {
    lastPreMergeGrid = g;
}
export function setLastCellSize(n) {
    lastCellSize = n;
}
export function setLastGridDims(cols, rows) {
    lastGridCols = cols;
    lastGridRows = rows;
}
export function pushRecentCode(code) {
    recentCodes = [code, ...recentCodes.filter((c) => c !== code)].slice(0, 12);
}
export function setPickerActive(row, col) {
    pickerActive.current = { row, col };
}
export function clearPickerActive() {
    pickerActive.current = null;
}

// 渲染调度(repaintCurrentMode / recomputePreservingRefine)已移至 render-bus.js,
// 形成单向依赖 render-bus → state/generate/fused-preview/color,消除循环 import。

// ---- 跨模块 helper:bgRemoval mutators ----
export function setBgRemovalEnabled(v) {
    bgRemovalEnabled = !!v;
}
export function setBgRemovalMode(m) {
    bgRemovalMode = m === 'manual' ? 'manual' : 'auto';
}
export function setBgThreshold(t) {
    bgThreshold = +t;
}
export function setSampleMatchThr(t) {
    sampleMatchThr = +t;
}
export function pushBgManualPoint(p) {
    bgManualPoints = [...bgManualPoints, p];
}
export function popBgManualPoint() {
    bgManualPoints = bgManualPoints.slice(0, -1);
}
export function clearBgManualPoints() {
    bgManualPoints = [];
}

// ---- 跨模块 helper:清空手动精修痕迹 ----
export function clearManualRefine() {
    editorHistory.length = 0;
    editorFuture.length = 0;
    pickerActive.current = null;
    recentCodes = [];
}
