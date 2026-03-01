/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/shared'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'shared/**/*.ts',
    '!shared/__tests__/**',
  ],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        types: ['node', 'jest'],
        strict: false,
        skipLibCheck: true,
      },
      diagnostics: false,
    }],
  },
};
