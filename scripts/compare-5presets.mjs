// scripts/compare-5presets.mjs
// 5 档预设 headless 对比:同一张图跑所有档位
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { extractCellFeatures, PRESETS } from '../public/js/algorithms/pixel-beads/cell-extract.js';
import { detectBackgroundMask } from '../public/js/algorithms/pixel-beads/background-mask.js';
import { assignBeads, resolveAssignmentsToBeads } from '../public/js/algorithms/pixel-beads/pipeline.js';

const inputPath = process.argv[2] || 'public/uploads/scan-test.png';
const cols = parseInt(process.argv[3] || '52');

const PALETTE = [
    { id: 'A01', code: 'A01', r: 255, g: 255, b: 255, hex: '#FFFFFF' },
    { id: 'A02', code: 'A02', r: 0, g: 0, b: 0, hex: '#000000' },
    { id: 'A03', code: 'A03', r: 200, g: 200, b: 200, hex: '#C8C8C8' },
    { id: 'A04', code: 'A04', r: 128, g: 128, b: 128, hex: '#808080' },
    { id: 'A11', code: 'A11', r: 255, g: 0, b: 0, hex: '#FF0000' },
    { id: 'A12', code: 'A12', r: 200, g: 0, b: 0, hex: '#C80000' },
    { id: 'A13', code: 'A13', r: 255, g: 100, b: 100, hex: '#FF6464' },
    { id: 'A14', code: 'A14', r: 255, g: 200, b: 200, hex: '#FFC8C8' },
    { id: 'A21', code: 'A21', r: 0, g: 255, b: 0, hex: '#00FF00' },
    { id: 'A22', code: 'A22', r: 0, g: 200, b: 0, hex: '#00C800' },
    { id: 'A23', code: 'A23', r: 100, g: 255, b: 100, hex: '#64FF64' },
    { id: 'A24', code: 'A24', r: 200, g: 255, b: 200, hex: '#C8FFC8' },
    { id: 'A31', code: 'A31', r: 0, g: 0, b: 255, hex: '#0000FF' },
    { id: 'A32', code: 'A32', r: 0, g: 0, b: 200, hex: '#0000C8' },
    { id: 'A33', code: 'A33', r: 100, g: 100, b: 255, hex: '#6464FF' },
    { id: 'A34', code: 'A34', r: 200, g: 200, b: 255, hex: '#C8C8FF' },
    { id: 'A41', code: 'A41', r: 255, g: 255, b: 0, hex: '#FFFF00' },
    { id: 'A42', code: 'A42', r: 255, g: 200, b: 0, hex: '#FFC800' },
    { id: 'A43', code: 'A43', r: 255, g: 255, b: 100, hex: '#FFFF64' },
    { id: 'A51', code: 'A51', r: 255, g: 0, b: 255, hex: '#FF00FF' },
    { id: 'A52', code: 'A52', r: 0, g: 255, b: 255, hex: '#00FFFF' },
    { id: 'A61', code: 'A61', r: 128, g: 64, b: 0, hex: '#804000' },
    { id: 'A62', code: 'A62', r: 200, g: 150, b: 100, hex: '#C89664' },
    { id: 'A71', code: 'A71', r: 255, g: 200, b: 150, hex: '#FFC896' },
];

const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
const imgW = info.width;
const imgH = info.height;
const imageData = new Uint8ClampedArray(data);
const rows = Math.round(cols * (imgH / imgW));

async function renderGrid(grid, cellSize) {
    const width = cols * cellSize;
    const height = rows * cellSize;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cell = grid[row][col];
            if (!cell || cell.transparent) continue;
            const x = col * cellSize;
            const y = row * cellSize;
            const hex = cell.hex || `#${[cell.r, cell.g, cell.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
            svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${hex}" stroke="#888" stroke-width="0.5"/>`;
        }
    }
    return sharp(Buffer.from(svg + '</svg>')).png().toBuffer();
}

const baseName = basename(inputPath, '.png');
const cellSize = 12;
console.log(`📂 ${inputPath} (${imgW}x${imgH})  网格 ${cols}x${rows}  调色板 ${PALETTE.length} 色\n`);

for (const presetId of Object.keys(PRESETS)) {
    const preset = PRESETS[presetId];
    const t0 = performance.now();
    const { mask: bgMask } = detectBackgroundMask({
        imageData,
        width: imgW,
        height: imgH,
        mode: 'auto',
        preset,
    });
    const cellFeatures = extractCellFeatures({
        imageData,
        imageWidth: imgW,
        imageHeight: imgH,
        targetWidth: cols,
        targetHeight: rows,
        backgroundMask: bgMask,
        preset,
    });
    const assignments = assignBeads({
        cells: cellFeatures,
        palette: PALETTE,
        k: preset.maxColors || cols * rows,
        outlineWeight: preset.outlineWeight,
    });
    const beads = resolveAssignmentsToBeads(assignments, PALETTE);
    const grid = Array(rows).fill().map(() => Array(cols).fill(null));
    let outlines = 0;
    let cells = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (cellFeatures[idx] && cellFeatures[idx].isOutline) outlines++;
            if (cellFeatures[idx]) cells++;
            grid[r][c] = beads[idx] || { transparent: true };
        }
    }
    const t1 = performance.now();
    const unique = new Set(assignments.filter((x) => x));
    const png = await renderGrid(grid, cellSize);
    const out = `/tmp/pb-5p-${baseName}-${presetId}.png`;
    writeFileSync(out, png);
    console.log(
        `  ${presetId.padEnd(11)} ${(t1 - t0).toFixed(0).padStart(4)}ms  ` +
        `${unique.size} 种 bead  ${cells} cell (${outlines} outline)  → ${out}`
    );
}
