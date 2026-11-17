/**
 * Ingress guard
 *
 * Refuses a request that was not verified as coming through the stage's CloudFront
 * distribution. The header comparison is done by @63klabs/cache-data
 * (ClientRequest.isIngressVerified()); this module only decides whether to refuse
 * and builds the refusal.
 *
 * The guard is off unless CACHE_DATA_INGRESS_SECRET_NAME is set. The template sets it
 * only when ApiIsBehindCloudFront is "true". Without the variable cache-data reports every
 * request as "direct", and isIngressVerified() is false for "direct", so an unconditional
 * guard would refuse all traffic.
 *
 * This module does not log, does not read any request header, and does not call AWS.
 *
 * @module ingress-guard
 */

const SECRET_NAME_VARIABLE = "CACHE_DATA_INGRESS_SECRET_NAME";
const REFUSAL_MESSAGE = "Requests must use the service endpoint.";

/**
 * Whether origin enforcement is turned on for this deployment.
 * @param {Object} [env=process.env] - Environment variables to read
 * @returns {boolean} true when the variable holds a non-empty string after trimming
 */
const isIngressGuardOn = (env = process.env) => {
	const name = env?.[SECRET_NAME_VARIABLE];
	return typeof name === "string" && name.trim().length > 0;
};

/**
 * Whether the request must be refused. Fails closed: when the guard is on,
 * anything other than isIngressVerified() === true refuses.
 * @param {Object} clientRequest - cache-data ClientRequest
 * @param {Object} [env=process.env] - Environment variables to read
 * @returns {boolean} true when the request must be refused
 */
const shouldRefuse = (clientRequest, env = process.env) => {
	if (!isIngressGuardOn(env)) {
		return false; // guard off: cache-data is not consulted
	}
	try {
		return clientRequest.isIngressVerified() !== true;
	} catch (error) {
		return true; // missing method, null request, or a throw: unverified
	}
};

/**
 * Turns the response into the 401 refusal. Status 401 is used because the Atlantis
 * distribution rewrites 403 and 404 to the landing page with HTTP 200 when a static origin exists.
 * Reset replaces the headers, so the cache headers are set after it.
 * The response is not finalized; the handler does that.
 * @param {Object} response - cache-data Response
 * @returns {Object} the same response, not finalized
 */
const buildRefusal = (response) => {
	response.reset({ statusCode: 401 });
	response.addHeader("Cache-Control", "no-store");
	response.addHeader("Expires", "0");
	response.setBody({ message: REFUSAL_MESSAGE });
	return response;
};

module.exports = {
	isIngressGuardOn,
	shouldRefuse,
	buildRefusal
};
