// scripts/compare-pix-beads-vs-legacy.mjs
// Headless 对比:pixel-beads mode vs legacy mode (dominant)
// 在同一张图上跑两种 mode,生成两个 grid JSON,直观对比差异
//
// 用法:
//   node scripts/compare-pix-beads-vs-legacy.mjs <input.png> [grid_cols]
//
// 输出:
//   /tmp/pb-compare-<basename>-legacy.json
//   /tmp/pb-compare-<basename>-pixel-beads.json
//   /tmp/pb-compare-<basename>-legacy.png
//   /tmp/pb-compare-<basename>-pixel-beads.png

import sharp from 'sharp';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, basename, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载算法模块
const algoDir = join(__dirname, '..', 'public', 'js', 'algorithms', 'pixel-beads');
const { extractCellFeatures, PRESETS } = await import(join(algoDir, 'cell-extract.js'));
const { detectBackgroundMask } = await import(join(algoDir, 'background-mask.js'));
const { assignBeads, resolveAssignmentsToBeads } = await import(join(algoDir, 'pipeline.js'));
const { rgbToOklab } = await import(join(__dirname, '..', 'public', 'js', 'oklab.js'));

// 内联 palette:用 pindou 的 p221 简化版(只列前 24 色作为 demo 调色板)
const DEMO_PALETTE = [
    { id: 'M01', code: 'M01', r: 255, g: 255, b: 255, hex: '#FFFFFF' },
    { id: 'M02', code: 'M02', r: 0, g: 0, b: 0, hex: '#000000' },
    { id: 'M03', code: 'M03', r: 200, g: 200, b: 200, hex: '#C8C8C8' },
    { id: 'M04', code: 'M04', r: 128, g: 128, b: 128, hex: '#808080' },
    { id: 'M11', code: 'M11', r: 255, g: 0, b: 0, hex: '#FF0000' },
    { id: 'M12', code: 'M12', r: 200, g: 0, b: 0, hex: '#C80000' },
    { id: 'M13', code: 'M13', r: 255, g: 100, b: 100, hex: '#FF6464' },
    { id: 'M14', code: 'M14', r: 255, g: 200, b: 200, hex: '#FFC8C8' },
    { id: 'M21', code: 'M21', r: 0, g: 255, b: 0, hex: '#00FF00' },
    { id: 'M22', code: 'M22', r: 0, g: 200, b: 0, hex: '#00C800' },
    { id: 'M23', code: 'M23', r: 100, g: 255, b: 100, hex: '#64FF64' },
    { id: 'M24', code: 'M24', r: 200, g: 255, b: 200, hex: '#C8FFC8' },
    { id: 'M31', code: 'M31', r: 0, g: 0, b: 255, hex: '#0000FF' },
    { id: 'M32', code: 'M32', r: 0, g: 0, b: 200, hex: '#0000C8' },
    { id: 'M33', code: 'M33', r: 100, g: 100, b: 255, hex: '#6464FF' },
    { id: 'M34', code: 'M34', r: 200, g: 200, b: 255, hex: '#C8C8FF' },
    { id: 'M41', code: 'M41', r: 255, g: 255, b: 0, hex: '#FFFF00' },
    { id: 'M42', code: 'M42', r: 255, g: 200, b: 0, hex: '#FFC800' },
    { id: 'M43', code: 'M43', r: 255, g: 255, b: 100, hex: '#FFFF64' },
    { id: 'M51', code: 'M51', r: 255, g: 0, b: 255, hex: '#FF00FF' },
    { id: 'M52', code: 'M52', r: 0, g: 255, b: 255, hex: '#00FFFF' },
    { id: 'M61', code: 'M61', r: 128, g: 64, b: 0, hex: '#804000' },
    { id: 'M62', code: 'M62', r: 200, g: 150, b: 100, hex: '#C89664' },
    { id: 'M71', code: 'M71', r: 255, g: 200, b: 150, hex: '#FFC896' },
];

// ============================================================================
// Legacy 模式:α-加权 RGB 众数 + 最近 bead
// ============================================================================

function legacyProcess(imageData, imgW, imgH, cols, rows, palette) {
    const result = Array(rows)
        .fill()
        .map(() => Array(cols).fill(null));

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const srcX = Math.round(col * (imgW / cols));
            const srcY = Math.round(row * (imgH / rows));
            const srcW = Math.ceil(imgW / cols);
            const srcH = Math.ceil(imgH / rows);

            // 提代表色:α-加权 RGB 众数
            const colorCounts = new Map();
            for (let y = srcY; y < srcY + srcH && y < imgH; y++) {
                for (let x = srcX; x < srcX + srcW && x < imgW; x++) {
                    const i = (y * imgW + x) * 4;
                    const a = imageData[i + 3];
                    if (a === 0) continue;
                    const key = `${imageData[i]},${imageData[i + 1]},${imageData[i + 2]}`;
                    colorCounts.set(key, (colorCounts.get(key) || 0) + a);
                }
            }
            if (colorCounts.size === 0) {
                result[row][col] = { transparent: true };
                continue;
            }
            let maxWeight = 0;
            let dominant = null;
            for (const [key, w] of colorCounts) {
                if (w > maxWeight) {
                    maxWeight = w;
                    const [r, g, b] = key.split(',').map(Number);
                    dominant = { r, g, b };
                }
            }
            // 最近 bead(Oklab 距离)
            const target = rgbToOklab(dominant.r, dominant.g, dominant.b);
            let minDist = Infinity;
            let best = palette[0];
            for (const c of palette) {
                const lab = rgbToOklab(c.r, c.g, c.b);
                const dL = target.L - lab.L;
                const da = target.a - lab.a;
                const db = target.b - lab.b;
                const d = Math.sqrt(dL * dL + da * da + db * db) * 100;
                if (d === 0) {
                    best = c;
                    break;
                }
                if (d < minDist) {
                    minDist = d;
                    best = c;
                }
            }
            result[row][col] = best;
        }
    }
    return result;
}

// ============================================================================
// Pixel-beads 模式:完整 pipeline
// ============================================================================

function pixelBeadsProcess(imageData, imgW, imgH, cols, rows, palette) {
    // 1. 背景 mask
    const { mask: bgMask } = detectBackgroundMask({
        imageData,
        width: imgW,
        height: imgH,
        mode: 'auto',
        preset: PRESETS.detailed,
    });
    // 2. 提取 cell
    const cellFeatures = extractCellFeatures({
        imageData,
        imageWidth: imgW,
        imageHeight: imgH,
        targetWidth: cols,
        targetHeight: rows,
        backgroundMask: bgMask,
        preset: PRESETS.detailed,
    });
    // 3. 分配
    const assignments = assignBeads({
        cells: cellFeatures,
        palette,
        k: PRESETS.detailed.maxColors,
        outlineWeight: PRESETS.detailed.outlineWeight,
    });
    // 4. 转回 grid
    const beads = resolveAssignmentsToBeads(assignments, palette);
    const result = Array(rows)
        .fill()
        .map(() => Array(cols).fill(null));
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const idx = row * cols + col;
            const f = cellFeatures[idx];
            const b = beads[idx];
            if (!f || !b) {
                result[row][col] = { transparent: true };
            } else {
                result[row][col] = b;
            }
        }
    }
    return { result, cellFeatures, assignments };
}

// ============================================================================
// 渲染:gridColors → PNG
// ============================================================================

async function renderGrid(grid, cols, rows, cellSize) {
    const width = cols * cellSize;
    const height = rows * cellSize;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
    let body = '';
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cell = grid[row][col];
            if (!cell || cell.transparent) continue;
            const x = col * cellSize;
            const y = row * cellSize;
            const hex = cell.hex || `#${[cell.r, cell.g, cell.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
            body += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${hex}" stroke="#888" stroke-width="0.5"/>`;
        }
    }
    return sharp(Buffer.from(svg + body + '</svg>')).png().toBuffer();
}

// ============================================================================
// 主流程
// ============================================================================

const inputPath = process.argv[2] || 'public/uploads/scan-test.png';
const cols = parseInt(process.argv[3] || '52');

console.log(`📂 输入: ${inputPath}`);
console.log(`🔢 网格: ${cols}x${cols}\n`);

// 加载图片
const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
const imgW = info.width;
const imgH = info.height;
const imageData = new Uint8ClampedArray(data);
console.log(`🖼️  原图: ${imgW}x${imgH}\n`);

const rows = Math.round(cols * (imgH / imgW));
console.log(`🎨 调色板: ${DEMO_PALETTE.length} 色 (demo 简化版)\n`);

// === Legacy ===
console.log('⏱️  跑 legacy (dominant)...');
const tLegacy0 = performance.now();
const legacyGrid = legacyProcess(imageData, imgW, imgH, cols, rows, DEMO_PALETTE);
const tLegacy1 = performance.now();
console.log(`  ✅ 完成 (${(tLegacy1 - tLegacy0).toFixed(0)}ms)`);

// === Pixel-beads ===
console.log('⏱️  跑 pixel-beads (detailed)...');
const tPb0 = performance.now();
const { result: pbGrid, cellFeatures, assignments } = pixelBeadsProcess(
    imageData,
    imgW,
    imgH,
    cols,
    rows,
    DEMO_PALETTE
);
const tPb1 = performance.now();
console.log(`  ✅ 完成 (${(tPb1 - tPb0).toFixed(0)}ms)\n`);

// 统计
function summarize(grid, name) {
    const beads = new Set();
    let transparent = 0;
    for (const row of grid) {
        for (const cell of row) {
            if (!cell || cell.transparent) {
                transparent++;
            } else {
                beads.add(cell.id || cell.code);
            }
        }
    }
    return { name, uniqueBeads: beads.size, transparent };
}
const legacyStats = summarize(legacyGrid, 'legacy');
const pbStats = summarize(pbGrid, 'pixel-beads');

console.log('📊 统计:');
console.log(`  legacy:    ${legacyStats.uniqueBeads} 种 bead, ${legacyStats.transparent} 透明格`);
console.log(`  pixel-beads: ${pbStats.uniqueBeads} 种 bead, ${pbStats.transparent} 透明格\n`);

console.log('🎨 渲染 PNG...');
const cellSize = 12;
const baseName = basename(inputPath, '.png');
const outDir = '/tmp';
const legacyPng = await renderGrid(legacyGrid, cols, rows, cellSize);
const pbPng = await renderGrid(pbGrid, cols, rows, cellSize);
writeFileSync(`${outDir}/pb-compare-${baseName}-legacy.png`, legacyPng);
writeFileSync(`${outDir}/pb-compare-${baseName}-pixel-beads.png`, pbPng);
console.log(`  ✅ /tmp/pb-compare-${baseName}-legacy.png`);
console.log(`  ✅ /tmp/pb-compare-${baseName}-pixel-beads.png\n`);

console.log('💾 保存 grid JSON...');
writeFileSync(
    `${outDir}/pb-compare-${baseName}-legacy.json`,
    JSON.stringify({ stats: legacyStats, grid: legacyGrid }, null, 2)
);
writeFileSync(
    `${outDir}/pb-compare-${baseName}-pixel-beads.json`,
    JSON.stringify({ stats: pbStats, grid: pbGrid, cellFeatures, assignments }, null, 2)
);
console.log(`  ✅ JSON 已保存\n`);

console.log('🎉 完成!');
