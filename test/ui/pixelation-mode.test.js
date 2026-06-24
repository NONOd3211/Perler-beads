// Task 1: UI Dropdown Wiring (4.1)
// 读 index.html source,断言 pixelationModeSelect 的 option 值/文本
// 当前期望:d项保持 'dominant',真实模式改为 'alpha-weighted' / '真实 (α-加权)'

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = resolve(__dirname, '../../public/index.html');
const html = readFileSync(INDEX_HTML, 'utf8');

function extractSelect(htmlSource) {
    const m = htmlSource.match(/<select\s+id="pixelationModeSelect"[\s\S]*?<\/select>/);
    return m ? m[0] : null;
}

const selectBlock = extractSelect(html);

describe('pixelationModeSelect', () => {
    it('应能找到 <select id="pixelationModeSelect"> 块', () => {
        expect(selectBlock).not.toBeNull();
    });

    // 仅在 selectBlock 存在时执行后续断言(否则 expect on null 会让 5 个 it 全挂)
    const itIfBlock = selectBlock ? it : it.skip;

    itIfBlock('应保留 value=dominant option 且 selected', () => {
        expect(selectBlock).toMatch(
            /<option\s+value="dominant"\s+selected>卡通\s*\(主色\)<\/option>/
        );
    });

    itIfBlock('真实 option 应为 value="alpha-weighted" 且文本 "真实 (α-加权)"', () => {
        expect(selectBlock).toMatch(/<option\s+value="alpha-weighted">真实\s*\(α-加权\)<\/option>/);
    });

    itIfBlock('不应存在 value="average" option', () => {
        expect(selectBlock).not.toMatch(/<option\s+value="average">真实\s*\(平均\)<\/option>/);
    });

    itIfBlock('不应存在 (平均) 文案', () => {
        expect(selectBlock).not.toMatch(/\(平均\)/);
    });

    itIfBlock('alpha-weighted option 应恰好出现 1 次', () => {
        const matches = selectBlock.match(/value="alpha-weighted"/g) || [];
        expect(matches.length).toBe(1);
    });

    it('select id 应保留 pixelationModeSelect', () => {
        expect(html).toMatch(/<select\s+id="pixelationModeSelect">/);
    });
});
