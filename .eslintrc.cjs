module.exports = {
  extends: ['@fingerprintjs/eslint-config-dx-team'],
  parserOptions: {
    project: './tsconfig.json',
  },
  ignorePatterns: ['dist/', 'coverage/'],
}
