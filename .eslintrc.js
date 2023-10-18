module.exports = {
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended"
    ],
    overrides: [
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
        "ecmaVersion": "latest",
        "sourceType": "module"
    },
    ignorePatterns: [
      ".eslintrc.js",
      "/tests",
      "/src/**/*.js"
    ],
    plugins: [
        "@typescript-eslint"
    ],
    rules: {
        semi: "error",
        "@typescript-eslint/no-explicit-any": "warn"
    }
};
