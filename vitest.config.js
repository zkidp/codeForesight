import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/store.js',
        'src/prd-parser.js',
        'src/jsonl-parser.js',
        'src/estimator/**/*.js',
        'src/scanner/**/*.js',
        'src/report/mermaid-merger.js',
        'src/report/mermaid-static.js',
        'src/report/minimal-md.js',
        'src/report/snapshots.js',
        'src/report/snippets.js',
        'src/report/inline-assets.js',
        'src/i18n/**/*.js',
        'src/charts/**/*.js'
      ],
      exclude: [
        'src/dashboard/**',           // exercised via e2e instead
        'src/report/templates/**',
        'src/report/generator.js',    // exercised via integration test
        'src/report/cc-settings.js',
        'src/report/narrative.js',    // hits external API; tested via mock
        'src/estimator/ai.js'         // hits external API
      ]
    }
  }
});
