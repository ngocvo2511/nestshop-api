const unit = require('./jest.config.cjs');
module.exports = {
  ...unit,
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/database.integration.cjs'],
  testTimeout: 60000,
  // The SAME TypeScript modules serve real HTTP requests and DB transactions inside Jest.
  // Ordinary integration tests retain built child processes as an independent check.
  resolver: '<rootDir>/test/helpers/source-resolver.cjs',
  collectCoverage: true,
  coverageReporters: ['text', 'json', 'json-summary', 'lcov'],
};
