import airbnb from 'eslint-stylistic-airbnb';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x'; // eslint-disable-line import-x/no-named-as-default
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

export default [
  { ignores: ['vitest.config.ts', 'dist/**', 'coverage/**'] },
  ...tseslint.configs.recommended, // eslint-disable-line import-x/no-named-as-default-member
  importX.flatConfigs.recommended, // eslint-disable-line import-x/no-named-as-default-member
  importX.flatConfigs.typescript, // eslint-disable-line import-x/no-named-as-default-member
  airbnb.configs['flat/recommended'],
  airbnb.configs['flat/addon-typescript'],
  airbnb.configs['flat/addon-import'],
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      'no-console': 'off',
      camelcase: ['error', { allow: ['login_', 'encKeyValidation_DO_NOT_EDIT'] }],
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import-x/prefer-default-export': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': ['error', {
        require: {
          FunctionDeclaration: true,
          ClassDeclaration: true,
          ArrowFunctionExpression: false,
          FunctionExpression: false,
          MethodDefinition: false,
        },
        publicOnly: true,
        checkGetters: false,
        checkSetters: false,
      }],
      'jsdoc/require-description': 'error',
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': ['error', {
        definedTags: ['security'],
      }],
      'jsdoc/check-types': 'off',
      'jsdoc/no-undefined-types': 'off',
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'import-x/no-default-export': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.vitest } },
  },
  {
    files: [
      '**/*.unit.test.ts',
      '**/*.integration.test.ts',
      '**/*.coverage.test.ts',
      'tests/**/*.ts',
    ],
    rules: {
      'import-x/no-extraneous-dependencies': [
        'error',
        {
          devDependencies: [
            '**/*.unit.test.ts',
            '**/*.integration.test.ts',
            '**/*.coverage.test.ts',
            'tests/**/*.ts',
            'vitest.config.ts',
          ],
        },
      ],
    },
  },
];
