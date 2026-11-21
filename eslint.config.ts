import { sssEslintConfig } from "@sss/sss-guis-eslint";

export default sssEslintConfig([
    {
        ignores: ["dist", "eslint.config.ts", "vitest.setup.ts"],
    },
    {
        languageOptions: {
            parserOptions: {
                allowDefaultProject: ["eslint.config.ts", "vitest.config.ts"],
            },
        },
    },
]);
