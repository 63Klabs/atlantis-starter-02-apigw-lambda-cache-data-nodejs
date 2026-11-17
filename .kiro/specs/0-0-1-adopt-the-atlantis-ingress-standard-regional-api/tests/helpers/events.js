/**
 * Minimal API Gateway (REST, proxy integration) event and Lambda context
 * for tests. Nothing here calls AWS.
 */

// RFC 5737 TEST-NET-3 documentation address. Never routable.
const TEST_SOURCE_IP = "203.0.113.10";

const DEFAULT_PATH = "/api/example";
const DEFAULT_RESOURCE = "/api/example";

/**
 * Build a minimal API Gateway proxy event.
 *
 * @param {object} [overrides={}]
 * @param {string} [overrides.path] Request path
 * @param {string} [overrides.resource] Resource path as defined in the API
 * @param {object} [overrides.headers] Request headers. Replaces the default headers.
 * @param {string} [overrides.httpMethod] HTTP method. Defaults to GET.
 * @returns {object} API Gateway proxy event
 */
const createEvent = (overrides = {}) => {
	const requestPath = overrides.path !== undefined ? overrides.path : DEFAULT_PATH;
	const resource = overrides.resource !== undefined ? overrides.resource : DEFAULT_RESOURCE;
	const headers = overrides.headers !== undefined ? overrides.headers : { Accept: "application/json" };

	return {
		httpMethod: overrides.httpMethod || "GET",
		path: requestPath,
		resource: resource,
		headers: { ...headers },
		queryStringParameters: null,
		pathParameters: null,
		requestContext: {
			identity: {
				sourceIp: TEST_SOURCE_IP
			},
			requestId: "test-request-id",
			resourcePath: resource
		}
	};
};

/**
 * Build a minimal Lambda context.
 *
 * @returns {object} Lambda context
 */
const createContext = () => ({
	awsRequestId: "test-aws-request-id",
	getRemainingTimeInMillis: () => 10000
});

module.exports = {
	TEST_SOURCE_IP,
	createEvent,
	createContext
};
