/**
 * Tests for FN/utils/ingress-guard.js
 *
 * Requirements: 6.1 to 6.10, 13.4, 13.5
 *
 * No test calls AWS. shouldRefuse is tested with plain doubles. buildRefusal is
 * tested with a real ClientRequest and Response from @63klabs/cache-data.
 */

const paths = require("./helpers/paths");
const { createEvent, createContext } = require("./helpers/events");

const guard = require(paths.ingressGuard);

const SECRET_NAME_VARIABLE = "CACHE_DATA_INGRESS_SECRET_NAME";
const SECRET_NAME = "acme-app-test-OriginSecret";
const SECRET_ARN = "arn:aws:secretsmanager:us-east-1:123456789012:secret:acme-app-test-OriginSecret-AbCdEf";
const HEADER_VALUE = "caller-supplied-header-value-0123456789";
const REFUSAL_MESSAGE = "Requests must use the service endpoint.";

const GUARD_ON_ENV = { [SECRET_NAME_VARIABLE]: SECRET_NAME };

let originalRegion;
let originalSecretName;
let consoleSpies;

/**
 * A request double that fails the test if anything on it is read or called.
 */
const createUntouchableRequest = () => new Proxy({}, {
	get: (target, property) => {
		throw new Error(`clientRequest.${String(property)} was accessed`);
	}
});

beforeEach(() => {
	originalRegion = process.env.AWS_REGION;
	originalSecretName = process.env[SECRET_NAME_VARIABLE];
	process.env.AWS_REGION = "us-east-1";
	delete process.env[SECRET_NAME_VARIABLE];

	// cache-data writes to the console; keep test output quiet and let tests check for logging
	consoleSpies = ["log", "info", "warn", "error", "debug"].map((method) =>
		jest.spyOn(console, method).mockImplementation(() => {})
	);
});

afterEach(() => {
	jest.restoreAllMocks();

	if (originalRegion === undefined) {
		delete process.env.AWS_REGION;
	} else {
		process.env.AWS_REGION = originalRegion;
	}

	if (originalSecretName === undefined) {
		delete process.env[SECRET_NAME_VARIABLE];
	} else {
		process.env[SECRET_NAME_VARIABLE] = originalSecretName;
	}
});

describe("ingress-guard module", () => {

	test("exports isIngressGuardOn, shouldRefuse, and buildRefusal as functions", () => {

		expect(typeof guard.isIngressGuardOn).toBe("function");
		expect(typeof guard.shouldRefuse).toBe("function");
		expect(typeof guard.buildRefusal).toBe("function");
	});
});

describe("isIngressGuardOn", () => {

	test.each([
		["variable unset", {}],
		["empty string", { [SECRET_NAME_VARIABLE]: "" }],
		["whitespace only", { [SECRET_NAME_VARIABLE]: "   " }],
		["tabs and newlines only", { [SECRET_NAME_VARIABLE]: "\t\n " }],
		["undefined value", { [SECRET_NAME_VARIABLE]: undefined }],
		["null value", { [SECRET_NAME_VARIABLE]: null }],
		["number value", { [SECRET_NAME_VARIABLE]: 42 }],
		["boolean value", { [SECRET_NAME_VARIABLE]: true }],
		["object value", { [SECRET_NAME_VARIABLE]: { name: SECRET_NAME } }]
	])("returns false when %s", (label, env) => {
		expect(guard.isIngressGuardOn(env)).toBe(false);
	});

	test("returns false when env is null", () => {
		expect(guard.isIngressGuardOn(null)).toBe(false);
	});

	test("returns true for a non-empty secret name", () => {
		expect(guard.isIngressGuardOn({ [SECRET_NAME_VARIABLE]: SECRET_NAME })).toBe(true);
	});

	test("returns true for a secret ARN", () => {
		expect(guard.isIngressGuardOn({ [SECRET_NAME_VARIABLE]: SECRET_ARN })).toBe(true);
	});

	test("returns true for a name with surrounding whitespace", () => {
		expect(guard.isIngressGuardOn({ [SECRET_NAME_VARIABLE]: `  ${SECRET_NAME}  ` })).toBe(true);
	});

	test("reads process.env when no env is passed", () => {

		expect(guard.isIngressGuardOn()).toBe(false);

		process.env[SECRET_NAME_VARIABLE] = SECRET_NAME;
		expect(guard.isIngressGuardOn()).toBe(true);
	});
});

describe("shouldRefuse with the guard off", () => {

	test.each([
		["variable unset", {}],
		["empty string", { [SECRET_NAME_VARIABLE]: "" }],
		["whitespace only", { [SECRET_NAME_VARIABLE]: "   " }]
	])("returns false and never touches the request when %s", (label, env) => {
		const request = createUntouchableRequest();

		expect(guard.shouldRefuse(request, env)).toBe(false);
	});

	test("does not call isIngressVerified when the guard is off", () => {
		const request = { isIngressVerified: jest.fn(() => false) };

		expect(guard.shouldRefuse(request, {})).toBe(false);
		expect(request.isIngressVerified).not.toHaveBeenCalled();
	});

	test("returns false for a null request when the guard is off", () => {
		expect(guard.shouldRefuse(null, {})).toBe(false);
	});
});

describe("shouldRefuse with the guard on", () => {

	test("returns false only when isIngressVerified returns true", () => {
		const request = { isIngressVerified: jest.fn(() => true) };

		expect(guard.shouldRefuse(request, GUARD_ON_ENV)).toBe(false);
		expect(request.isIngressVerified).toHaveBeenCalledTimes(1);
	});

	test("reads process.env when no env is passed", () => {
		const request = { isIngressVerified: jest.fn(() => false) };

		// process.env has no secret name: the guard is off and the request is not consulted
		expect(guard.shouldRefuse(request)).toBe(false);
		expect(request.isIngressVerified).not.toHaveBeenCalled();

		process.env[SECRET_NAME_VARIABLE] = SECRET_NAME;
		expect(guard.shouldRefuse(request)).toBe(true);
		expect(request.isIngressVerified).toHaveBeenCalledTimes(1);
	});

	test.each([
		["false", false],
		["undefined", undefined],
		["the string 'true'", "true"],
		["the number 1", 1],
		["null", null],
		["an object", {}],
		["an empty string", ""]
	])("returns true when isIngressVerified returns %s", (label, returnValue) => {
		const request = { isIngressVerified: () => returnValue };

		expect(guard.shouldRefuse(request, GUARD_ON_ENV)).toBe(true);
	});

	test("returns true when isIngressVerified is missing", () => {
		expect(guard.shouldRefuse({}, GUARD_ON_ENV)).toBe(true);
	});

	test.each([
		["a string", "verified"],
		["true", true],
		["a number", 1],
		["null", null]
	])("returns true when isIngressVerified is %s and not a function", (label, notAFunction) => {
		expect(guard.shouldRefuse({ isIngressVerified: notAFunction }, GUARD_ON_ENV)).toBe(true);
	});

	test("returns true when isIngressVerified throws", () => {
		const request = {
			isIngressVerified: () => {
				throw new Error("boom");
			}
		};

		expect(guard.shouldRefuse(request, GUARD_ON_ENV)).toBe(true);
	});

	test.each([
		["null", null],
		["undefined", undefined]
	])("returns true when the request is %s", (label, request) => {
		expect(guard.shouldRefuse(request, GUARD_ON_ENV)).toBe(true);
	});

	test("does not log when it refuses", () => {
		const request = {
			isIngressVerified: () => {
				throw new Error(`failure with ${SECRET_NAME}`);
			}
		};

		expect(guard.shouldRefuse(request, GUARD_ON_ENV)).toBe(true);
		consoleSpies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
	});
});

describe("buildRefusal with real cache-data classes", () => {

	/**
	 * Build a real ClientRequest and Response. The secret name is set so cache-data treats the
	 * request as unverified (the secret is not primed and no AWS call is made).
	 */
	const createRealPair = (headers, secretName = SECRET_NAME) => {
		process.env[SECRET_NAME_VARIABLE] = secretName;

		const { tools: { ClientRequest, Response } } = require("@63klabs/cache-data");
		const event = createEvent({ headers });
		const clientRequest = new ClientRequest(event, createContext());
		const response = new Response(clientRequest);

		return { clientRequest, response };
	};

	test("returns the same response object it was given", () => {
		const { response } = createRealPair({ Accept: "application/json" });

		expect(guard.buildRefusal(response)).toBe(response);
	});

	test("produces a 401 with no-store, Expires 0, JSON content type, and the fixed message", () => {
		const { response } = createRealPair({ Accept: "application/json" });

		const result = guard.buildRefusal(response).finalize();

		expect(result.statusCode).toBe(401);
		expect(result.headers["Cache-Control"]).toBe("no-store");
		expect(result.headers["Expires"]).toBe("0");
		expect(result.headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(result.body)).toEqual({ message: REFUSAL_MESSAGE });
		expect(result.body).toBe(JSON.stringify({ message: REFUSAL_MESSAGE }));
	});

	test.each([403, 404])("does not use status %i", (forbiddenStatus) => {
		const { response } = createRealPair({ Accept: "application/json" });

		const result = guard.buildRefusal(response).finalize();

		expect(result.statusCode).not.toBe(forbiddenStatus);
	});

	test("replaces a status, headers, and body that were set before the refusal", () => {
		const { response } = createRealPair({ Accept: "application/json" });

		response.setStatusCode(200);
		response.addHeader("Cache-Control", "max-age=600");
		response.addHeader("X-Earlier-Header", "earlier");
		response.setBody({ data: "earlier body" });

		const result = guard.buildRefusal(response).finalize();

		expect(result.statusCode).toBe(401);
		expect(result.headers["Cache-Control"]).toBe("no-store");
		expect(result.headers["Expires"]).toBe("0");
		expect(result.headers["X-Earlier-Header"]).toBeUndefined();
		expect(result.body).not.toContain("earlier body");
	});

	test("refusal does not contain the header value, the secret ARN, or the reason", () => {
		process.env[SECRET_NAME_VARIABLE] = SECRET_ARN;

		const { clientRequest, response } = createRealPair({
			Accept: "application/json",
			"X-Atlantis-Origin-Secret": HEADER_VALUE
		});
		// createRealPair sets the variable to the name; use the ARN for the request as well
		process.env[SECRET_NAME_VARIABLE] = SECRET_ARN;

		expect(guard.shouldRefuse(clientRequest)).toBe(true);

		const result = guard.buildRefusal(response).finalize();
		const serialized = JSON.stringify(result).toLowerCase();

		expect(serialized).not.toContain(HEADER_VALUE.toLowerCase());
		expect(serialized).not.toContain(SECRET_NAME.toLowerCase());
		expect(serialized).not.toContain(SECRET_ARN.toLowerCase());
		expect(serialized).not.toContain("secret-not-primed");
		expect(serialized).not.toContain("unverified");
	});

	test("refusal does not contain the header value or secret name when the name is not an ARN", () => {
		const { clientRequest, response } = createRealPair({
			Accept: "application/json",
			"X-Atlantis-Origin-Secret": HEADER_VALUE
		});

		expect(guard.shouldRefuse(clientRequest)).toBe(true);

		const result = guard.buildRefusal(response).finalize();
		const serialized = JSON.stringify(result);

		expect(serialized).not.toContain(HEADER_VALUE);
		expect(serialized).not.toContain(SECRET_NAME);
	});

	test("the guard itself does not write the header value or secret name to the log", () => {
		const { clientRequest, response } = createRealPair({
			Accept: "application/json",
			"X-Atlantis-Origin-Secret": HEADER_VALUE
		});

		// Ignore anything cache-data wrote while building the request
		consoleSpies.forEach((spy) => spy.mockClear());

		guard.shouldRefuse(clientRequest);
		guard.buildRefusal(response);

		const loggedText = JSON.stringify(consoleSpies.map((spy) => spy.mock.calls));
		expect(loggedText).not.toContain(HEADER_VALUE);
		expect(loggedText).not.toContain(SECRET_NAME);
	});

	test("a real unverified ClientRequest is refused and a real direct one is not consulted", () => {
		const { clientRequest } = createRealPair({ Accept: "application/json" });

		// Guard on, secret not primed: cache-data reports the request as unverified
		expect(guard.shouldRefuse(clientRequest)).toBe(true);

		// Guard off: refuses nothing, even though cache-data would report "direct"
		delete process.env[SECRET_NAME_VARIABLE];
		expect(guard.shouldRefuse(clientRequest)).toBe(false);
	});
});
