module.exports = {
  root: true,
  env: { es2021: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['.eslintrc.cjs', 'node_modules'],
  parser: '@typescript-eslint/parser',
};
