const { statusCodes } = require("../models/static-data/index.js");
const { tools: {DebugAndLog} } = require("@63klabs/cache-data");

const referrers = [
	"63klabs.net",
	"chadkluck.net",
];

const isString = (value) => {
	return typeof value === "string";
};

const isStringOfNumbers = (value) => {
	// using regex, check if all the characters are digits
	return /^\d+$/.test(value);
};

// validate organizationCode based on Config.getSettings('orgCodes') which has an array of organization_code and name pairs
// returns true if organizationCode is found in the array, false otherwise
// used in the organizationCode route handler to validate the organizationCode parameter
const statusCodePathParameter = (code) => {
	if (!Array.isArray(statusCodes) || statusCodes.length < 1) {
		DebugAndLog.error("No status codes found in the application's static data folder '/models/static-data'!");
		return false;
	}
	if (!code) return false;
	if (!isString(code)) return false;
	if (code.length === 0) return false;
	return statusCodes.some((statusCode) => statusCode.code === code);
};

const idPathParameter = (id) => {
	if (!id) return false;
	if (!isString(id)) return false;
	// separate id by -
	const [char, gid] = id.split("-");
	if (!char || !gid) return false;
	if (!isStringOfNumbers(gid)) return false;
	// check if char is a letter
	if (!char.match(/[A-Z]/)) return false;
	// check if number is a number within range
	const idNumber = parseInt(gid, 10);
	if (isNaN(idNumber)) return false; // not a number
	if (idNumber < 1 || idNumber > 15) return false;
	return true;
};

/**
 * The exported alias must match the parameter name in the request coming in.
 * The Request object will automatically validate the parameter based on the function name and exclude any request parameter that does not have a check.
 * You can define and re-use simple checks such as isString for multiple parameters if that is all you need.
 */
module.exports = {
	referrers,
	parameters: {
		pathParameters: {
			code: statusCodePathParameter,
			id: idPathParameter
		}
		//, queryParameter: {}
		//, headerParameter: {}
		//, cookieParameter: {}
		//, bodyParameter: {}		
	}
};
