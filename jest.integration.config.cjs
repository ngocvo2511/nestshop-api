module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.integration.cjs'],
  transform: {},
  testTimeout: 60000,
  clearMocks: true,
};
