import globals from 'globals';

// ESLint 9 flat config — pindou 项目
// B 阶段(ESM 化)配置:
// 1) ignores: node_modules / openspec / docs / coverage / test/**/*.html / lockfile
// 2) 全局:浏览器 + ES2024 + node + sourceType: 'module' (ESM)
// 3) 规则:eslint:recommended + no-unused-vars 允许下划线前缀 + no-undef 严格

export default [
    {
        ignores: [
            'node_modules/**',
            'openspec/**',
            'docs/**',
            'coverage/**',
            'test/**/*.html',
            'package-lock.json',
        ],
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2024,
                ...globals.node,
            },
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-undef': 'error',
        },
    },
];
