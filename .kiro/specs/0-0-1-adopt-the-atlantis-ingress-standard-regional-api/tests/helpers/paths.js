/**
 * Absolute paths to the shipped files that the spec-local tests read.
 *
 * Every path is resolved from this file's location, so the tests work from
 * any current working directory and never copy a shipped file.
 *
 * Layout: <repo>/.kiro/specs/<spec>/tests/helpers/paths.js
 */
const path = require("path");

const REPOSITORY_ROOT = path.resolve(__dirname, "../../../../..");
const INFRASTRUCTURE_DIR = path.join(REPOSITORY_ROOT, "application-infrastructure");
const FUNCTION_DIR = path.join(INFRASTRUCTURE_DIR, "src", "lambda", "web-service");

module.exports = {
	repositoryRoot: REPOSITORY_ROOT,
	template: path.join(INFRASTRUCTURE_DIR, "template.yml"),
	openApiSpec: path.join(INFRASTRUCTURE_DIR, "template-openapi-spec.yml"),
	dashboard: path.join(INFRASTRUCTURE_DIR, "template-dashboard.yml"),
	templateConfiguration: path.join(INFRASTRUCTURE_DIR, "template-configuration.json"),
	functionDir: FUNCTION_DIR,
	ingressGuard: path.join(FUNCTION_DIR, "utils", "ingress-guard.js"),
	routes: path.join(FUNCTION_DIR, "routes", "index.js")
};
