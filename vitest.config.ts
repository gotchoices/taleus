import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/auto/**/*.ts'],
    exclude: ['test/auto/helpers/**', 'node_modules', 'dist']
  }
})


