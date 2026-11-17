const path = require("path");

const FUNCTION_DIR = path.resolve(__dirname, "../../../../application-infrastructure/src/lambda/web-service");

module.exports = {
	testEnvironment: "node",
	rootDir: __dirname,
	testMatch: ["<rootDir>/*.test.js"],
	// One copy of @63klabs/cache-data: the tests and the shipped files resolve to the function's node_modules
	modulePaths: [path.join(FUNCTION_DIR, "node_modules")],
	coverageDirectory: path.join(__dirname, "coverage")
};
