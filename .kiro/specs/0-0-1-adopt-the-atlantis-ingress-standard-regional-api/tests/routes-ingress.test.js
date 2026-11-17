/**
 * Tests for the ingress guard wiring in FN/routes/index.js
 *
 * Requirements: 7.1, 7.2, 7.3, 7.6, 13.4, 13.6
 *
 * A real ClientRequest and Response from @63klabs/cache-data are used. Only the
 * controllers module is replaced, so a controller call is observable. No test
 * calls AWS.
 */

// The path must be a literal so jest can hoist this call above the requires.
// From tests/ four levels up is the repository root.
jest.mock("../../../../application-infrastructure/src/lambda/web-service/controllers", () => ({
	ExampleCtrl: {
		get: jest.fn()
	}
}));

const path = require("path");

const paths = require("./helpers/paths");
const { createEvent, createContext } = require("./helpers/events");

const { tools: { ClientRequest } } = require("@63klabs/cache-data");
const Controllers = require("../../../../application-infrastructure/src/lambda/web-service/controllers");
const Routes = require(paths.routes);

const SECRET_NAME_VARIABLE = "CACHE_DATA_INGRESS_SECRET_NAME";
const SECRET_NAME = "acme-app-test-OriginSecret";
const HEADER_VALUE = "caller-supplied-header-value-0123456789";
const CONTROLLER_BODY = { items: ["example"] };

// A path parameter value that the function's validations reject (valid form is G-<8 hex digits>)
const INVALID_ID = "not-a-valid-id";

let originalRegion;
let originalSecretName;

/**
 * Build an event for a path that ClientRequest reports as invalid. The
 * `id` path parameter fails the function's own validations.
 */
const createInvalidPathEvent = () => {
	const event = createEvent({
		path: `/api/example/${INVALID_ID}`,
		resource: "/api/example/{id}",
		headers: { Accept: "application/json", "X-Atlantis-Origin-Secret": HEADER_VALUE }
	});

	// API Gateway fills pathParameters from the resource template
	event.pathParameters = { id: INVALID_ID };

	return event;
};

beforeAll(() => {
	// Same validations the function loads through Config.init()
	const validations = require(path.join(paths.functionDir, "config", "validations.js"));
	ClientRequest.init(validations);
});

beforeEach(() => {
	originalRegion = process.env.AWS_REGION;
	originalSecretName = process.env[SECRET_NAME_VARIABLE];
	process.env.AWS_REGION = "us-east-1";
	delete process.env[SECRET_NAME_VARIABLE];

	// cache-data writes to the console; keep test output quiet
	["log", "info", "warn", "error", "debug"].forEach((method) => {
		jest.spyOn(console, method).mockImplementation(() => {});
	});

	Controllers.ExampleCtrl.get.mockReset();
	Controllers.ExampleCtrl.get.mockResolvedValue(CONTROLLER_BODY);
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

describe("Routes.process with the ingress guard on and the request unverified", () => {

	test("returns 401 and never calls a controller", async () => {
		process.env[SECRET_NAME_VARIABLE] = SECRET_NAME;

		const event = createEvent({
			headers: { Accept: "application/json", "X-Atlantis-Origin-Secret": HEADER_VALUE }
		});

		const response = await Routes.process(event, createContext());
		const result = response.finalize();

		expect(result.statusCode).toBe(401);
		expect(result.headers["Cache-Control"]).toBe("no-store");
		expect(Controllers.ExampleCtrl.get).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toContain(HEADER_VALUE);
		expect(JSON.stringify(result)).not.toContain(SECRET_NAME);
	});
});

describe("Routes.process with the ingress guard on and the request verified", () => {

	test("routes the request to the controller as before", async () => {
		process.env[SECRET_NAME_VARIABLE] = SECRET_NAME;
		const verifiedSpy = jest.spyOn(ClientRequest.prototype, "isIngressVerified").mockReturnValue(true);

		const response = await Routes.process(createEvent(), createContext());
		const result = response.finalize();

		expect(verifiedSpy).toHaveBeenCalled();
		expect(Controllers.ExampleCtrl.get).toHaveBeenCalledTimes(1);
		expect(result.statusCode).toBe(200);
		expect(JSON.parse(result.body)).toEqual(CONTROLLER_BODY);
	});
});

describe("Routes.process with the ingress guard off", () => {

	test("routes the request to the controller and does not consult isIngressVerified", async () => {
		const verifiedSpy = jest.spyOn(ClientRequest.prototype, "isIngressVerified").mockReturnValue(true);

		const response = await Routes.process(createEvent(), createContext());
		const result = response.finalize();

		expect(verifiedSpy).not.toHaveBeenCalled();
		expect(Controllers.ExampleCtrl.get).toHaveBeenCalledTimes(1);
		expect(result.statusCode).toBe(200);
		expect(JSON.parse(result.body)).toEqual(CONTROLLER_BODY);
	});

	test("an unverified request is still served when the variable is blank", async () => {
		process.env[SECRET_NAME_VARIABLE] = "   ";

		const response = await Routes.process(createEvent(), createContext());

		expect(response.finalize().statusCode).toBe(200);
		expect(Controllers.ExampleCtrl.get).toHaveBeenCalledTimes(1);
	});
});

describe("Routes.process with an invalid request", () => {

	test("the invalid event is reported as 400 when the guard is off (control case)", async () => {
		const response = await Routes.process(createInvalidPathEvent(), createContext());

		expect(response.finalize().statusCode).toBe(400);
		expect(Controllers.ExampleCtrl.get).not.toHaveBeenCalled();
	});

	test("an unverified invalid request gets 401 and not 400 when the guard is on", async () => {
		process.env[SECRET_NAME_VARIABLE] = SECRET_NAME;

		const response = await Routes.process(createInvalidPathEvent(), createContext());
		const result = response.finalize();

		expect(result.statusCode).toBe(401);
		expect(result.statusCode).not.toBe(400);
		expect(Controllers.ExampleCtrl.get).not.toHaveBeenCalled();
	});
});
