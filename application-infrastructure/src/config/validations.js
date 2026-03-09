/*
	Functions to validate request parameters

*/


/* Helper functions
	Add any function that assists in this scripts internal validation here
	These are not exported, they are used by the validators
*/

/**
 * Ensure value is a string of numbers
 * @param {string} value - The value to validate
 * @returns {boolean} - True if the value is a string of numbers, false otherwise
 */
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
	if (!id.match(/^G\-[a-f0-9]{8}$/)) return false;
	return true;
};

/**
 * Ensure players is a number between 1 and 10
 * @param {string} players - The players to validate
 * @returns {boolean} - True if the players is valid, false otherwise
 */
const playersQueryParameter = (players) => {
	if (!isStringOfNumbers(players)) return false;
	const plyrs = parseInt(players, 10); // convert to Int
	if (plyrs < 0 || plyrs > 10) return false;
	return true;
};

/**
 * The exported alias must match the parameter name in the request coming in.
 * The Request object will automatically validate the parameter based on the function name or path.
 * You can define and re-use simple checks such as isString for multiple parameters if that is all you need.
 */
module.exports = {
	/**
	 * For Access and CORS, what domains listed in the 'Referers' header should
	 * be allowed access. Can be all '*' or specific domains. Domain matching is
	 * from right to left, so example.com would allow sub.example.com.
	 * @returns {Array<string>}
	 * @example
	 * referrers = ['*']; // allow all referrers
	 * referrers = ['myapp.com', 'example.com']; // allow specific referrers (and subdomains)
	 */
	referrers: ['*'],
	/**
	 * Set to false when relying on API Gateway OpenAPI and validation within Lambda only secondary.
	 * Set to true only when ALL validation occurs on Lambda side.
	 * @returns {boolean}
	 */
	excludeParamsWithNoValidationMatch: false,
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
