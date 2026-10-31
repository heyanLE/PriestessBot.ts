import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false, 'ts-expect-error': true }],
      'no-restricted-syntax': ['error',
        { selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])", message: 'Validate and narrow values instead of asserting their types.' },
        { selector: 'TSTypeAssertion', message: 'Type assertions cannot replace boundary validation.' }
      ]
    }
  },
  {
    files: ['packages/core/**/*.ts', 'packages/contracts/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@openai/*', 'openai'] }] }
  }
);
