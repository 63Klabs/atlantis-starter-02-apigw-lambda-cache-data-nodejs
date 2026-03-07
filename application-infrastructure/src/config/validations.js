const { tools: {DebugAndLog} } = require("@63klabs/cache-data");

const referrers = ['*'];

const isString = (value) => {
	return typeof value === "string";
};

const isStringOfNumbers = (value) => {
	// using regex, check if all the characters are digits
	return /^\d+$/.test(value);
};

/**
 * Ensure id is in 'G-<8-char-hex>' format
 * @param {string} id - The id to validate
 * @returns {boolean} - True if the id is valid, false otherwise
 */
const idPathParameter = (id) => {
	if (!id) return false;
	if (!id.match(/^G\-[a-f0-9]{8}$/)) return false;
	return true;
};

/**
 * Ensure players is a number between 1 and 10
 * @param {string} players - The players to validate
 * @returns {boolean} - True if the players is valid, false otherwise
 */
const playersQueryParameter = (players) => {
	if (!players) return false;
	if (!isStringOfNumbers(players)) return false;
	if (players < 1 || players > 10) return false;
	return true;
};

/**
 * The exported alias must match the parameter name in the request coming in.
 * The Request object will automatically validate the parameter based on the function name and exclude any request parameter that does not have a check.
 * You can define and re-use simple checks such as isString for multiple parameters if that is all you need.
 */
module.exports = {
	referrers,
	excludeParamsWithNoValidationMatch: true, // rely on API Gateway OpenAPI spec to be first line validation
	parameters: {
		pathParameters: {
			code: statusCodePathParameter,
			id: idPathParameter,
		},
		queryParameters: {
			players: playersQueryParameter,
			BY_ROUTE: [{route: "GET:api/example?plyrs", validate: playersQueryParameter}]
		},
		// headerParameters: {},
		// cookieParameters: {},
		// bodyParameters: {},	
	}
};
