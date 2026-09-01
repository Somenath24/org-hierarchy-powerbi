/** Jest config for Organization Tree Visual unit tests (hierarchy.ts / dataMapping.ts). */
module.exports = {
    testEnvironment: "node",
    roots: ["<rootDir>/test"],
    testMatch: ["**/*.test.ts"],
    transform: {
        "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.test.json" }]
    }
};
