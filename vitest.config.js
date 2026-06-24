import { defineConfig } from 'vitest/config';

// Vitest 2 + jsdom 25 配置
// - environment: jsdom(浏览器 window/document 模拟)
// - globals: false(显式 import describe/it/expect,IDE 跳转可用)
// - include: 只跑 *.test.js;HTML 测试在 setup.js 加载前就被排除
// - setupFiles: 已删除(B 阶段 ESM 化,测试直接 import 真实模块,无需 fs+eval 桥接)

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: false,
        include: ['test/**/*.test.js'],
        exclude: ['test/**/*.html', 'node_modules/**'],
    },
});
