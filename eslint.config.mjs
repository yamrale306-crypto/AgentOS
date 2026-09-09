import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/out/**',
      '**/.next/**',
      '**/coverage/**',
      '*.js',
      '*.mjs',
      '*.cjs',
      // Standalone app trees that are not part of the pnpm workspace.
      'frontend/**',
      'desktop/**',
      'mobile/**',
      'AgentOS/**',
      'new-update/**',
      'supabase/**'
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      // Pragmatic relaxations for test helpers and JSON/dynamic plumbing.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `declare global { namespace Express {...} }` is the canonical way to
      // augment Express.Request with the authenticated user.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
    }
  }
);