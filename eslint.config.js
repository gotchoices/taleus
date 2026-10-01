import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(
	{ ignores: ['**/dist/**'] },
	{
		files: ['**/*.ts'],
		extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir,
			},
			globals: {
				...globals.node,
			},
		},
		rules: {
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/no-explicit-any': 'error',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
		},
	},
	{
		// The API surface is async by rule, not by present need: `SPEC.md` § 2 requires every
		// operation that *could* ever wait to be async today, because widening a sync function
		// later breaks every caller. Several of them do not await anything yet, and that is the
		// design rather than an oversight.
		// The same holds for the app model's surface: every model operation is async because the
		// engine implementation behind it will await, even where the mock answers at once.
		files: ['packages/taleus-core/src/api/**/*.ts', 'packages/taleus-model/src/**/*.ts'],
		rules: {
			'@typescript-eslint/require-await': 'off',
		},
	},
	{
		files: ['**/*.test.ts'],
		languageOptions: {
			globals: {
				...globals.jest,
			},
		},
	},
)
