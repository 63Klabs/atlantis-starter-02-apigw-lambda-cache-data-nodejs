/**
 * Load template.yml and evaluate it for a set of parameter values, so tests
 * assert on what CloudFormation would create and not on how the template is
 * written.
 *
 * Supported YAML short tags: Ref, Sub, GetAtt, If, Equals, Not, And, Or,
 * FindInMap, Condition, ImportValue, Join. Any other tag makes loading fail
 * with an error that names the tag.
 *
 * Supported intrinsic functions in resolve(): Fn::If is evaluated; Ref to a
 * supplied parameter and Ref to AWS::NoValue are replaced; Fn::Sub,
 * Fn::GetAtt, Fn::ImportValue, Fn::FindInMap, Fn::Join, Fn::Equals, Fn::Not,
 * Fn::And, Fn::Or, and Fn::Transform are left in place (their contents are
 * still resolved). Any other Fn:: function throws an error that names it.
 */
const fs = require("fs");
const yaml = require("js-yaml");
const paths = require("./paths");

// Short tag name to long form key. Ref and Condition have no "Fn::" prefix.
const TAGS = {
	Ref: "Ref",
	Condition: "Condition",
	Sub: "Fn::Sub",
	GetAtt: "Fn::GetAtt",
	If: "Fn::If",
	Equals: "Fn::Equals",
	Not: "Fn::Not",
	And: "Fn::And",
	Or: "Fn::Or",
	FindInMap: "Fn::FindInMap",
	ImportValue: "Fn::ImportValue",
	Join: "Fn::Join"
};

// Functions that resolve() leaves in place.
const PASS_THROUGH_FUNCTIONS = new Set([
	"Fn::Sub",
	"Fn::GetAtt",
	"Fn::ImportValue",
	"Fn::FindInMap",
	"Fn::Join",
	"Fn::Equals",
	"Fn::Not",
	"Fn::And",
	"Fn::Or",
	"Fn::Transform"
]);

const NO_VALUE = Symbol("AWS::NoValue");

/**
 * Convert the data of a tagged node to its long form.
 * `!GetAtt Resource.Attribute` becomes ["Resource", "Attribute"].
 */
const toLongForm = (longKey, data) => {
	if (longKey === "Fn::GetAtt" && typeof data === "string") {
		const dot = data.indexOf(".");
		if (dot === -1) {
			throw new Error(`!GetAtt scalar must be "Resource.Attribute": ${data}`);
		}
		return { [longKey]: [data.slice(0, dot), data.slice(dot + 1)] };
	}
	return { [longKey]: data };
};

const buildSchema = () => {
	const types = [];
	for (const [tagName, longKey] of Object.entries(TAGS)) {
		for (const kind of ["scalar", "sequence", "mapping"]) {
			types.push(new yaml.Type(`!${tagName}`, {
				kind,
				construct: (data) => toLongForm(longKey, data)
			}));
		}
	}
	return yaml.DEFAULT_SCHEMA.extend(types);
};

const CFN_SCHEMA = buildSchema();

/**
 * Parse CloudFormation YAML text.
 *
 * @param {string} text YAML text
 * @param {string} [label="template"] Name used in error messages
 * @returns {object} Template with short tags converted to long form
 * @throws {Error} Naming the tag when a tag is not supported
 */
const parseTemplate = (text, label = "template") => {
	try {
		return yaml.load(text, { schema: CFN_SCHEMA });
	} catch (error) {
		const unknownTag = /unknown tag (!<[^>]*>|\S+)/.exec(error.message);
		if (unknownTag) {
			throw new Error(`Unsupported CloudFormation YAML tag ${unknownTag[1]} in ${label}`);
		}
		throw error;
	}
};

/**
 * Parse application-infrastructure/template.yml (or another file).
 *
 * @param {string} [filePath] Defaults to template.yml
 * @returns {object} Parsed template
 */
const loadTemplate = (filePath = paths.template) => {
	return parseTemplate(fs.readFileSync(filePath, "utf8"), filePath);
};

/**
 * Parameter values to use: template defaults with the given values on top.
 * Rejects a name the template does not declare (pseudo parameters such as
 * AWS::Region are allowed) and a value outside AllowedValues.
 */
const effectiveParameters = (template, parameters = {}) => {
	const declared = template.Parameters || {};
	const values = {};

	for (const [name, definition] of Object.entries(declared)) {
		if (definition && definition.Default !== undefined) {
			values[name] = definition.Default;
		}
	}

	for (const [name, value] of Object.entries(parameters)) {
		if (!name.includes("::")) {
			if (!Object.prototype.hasOwnProperty.call(declared, name)) {
				throw new Error(`Parameter "${name}" is not declared in the template`);
			}
			const allowed = declared[name].AllowedValues;
			if (Array.isArray(allowed) && !allowed.map(String).includes(String(value))) {
				throw new Error(`Value "${value}" is not allowed for parameter "${name}"`);
			}
		}
		values[name] = value;
	}

	return values;
};

const singleKey = (node) => {
	if (node === null || typeof node !== "object" || Array.isArray(node)) {
		return undefined;
	}
	const keys = Object.keys(node);
	return keys.length === 1 ? keys[0] : undefined;
};

/**
 * Evaluate one expression of the Conditions section.
 */
const evaluateExpression = (node, template, values, evaluateNamed, conditionName) => {
	if (node === null || typeof node !== "object") {
		return node;
	}

	const key = singleKey(node);
	const evaluate = (child) => evaluateExpression(child, template, values, evaluateNamed, conditionName);

	switch (key) {
		case "Ref": {
			const name = node.Ref;
			if (!Object.prototype.hasOwnProperty.call(values, name)) {
				throw new Error(`Condition "${conditionName}": Ref "${name}" has no value`);
			}
			return values[name];
		}
		case "Condition":
			return evaluateNamed(node.Condition);
		case "Fn::Equals": {
			const [left, right] = node["Fn::Equals"].map(evaluate);
			return String(left) === String(right);
		}
		case "Fn::Not":
			return !evaluate(node["Fn::Not"][0]);
		case "Fn::And":
			return node["Fn::And"].map(evaluate).every((value) => value === true);
		case "Fn::Or":
			return node["Fn::Or"].map(evaluate).some((value) => value === true);
		case "Fn::FindInMap": {
			const [mapName, topKey, secondKey] = node["Fn::FindInMap"].map(evaluate);
			const found = ((template.Mappings || {})[mapName] || {})[topKey];
			if (!found || found[secondKey] === undefined) {
				throw new Error(`Condition "${conditionName}": Fn::FindInMap found no value for ${mapName}/${topKey}/${secondKey}`);
			}
			return found[secondKey];
		}
		default:
			throw new Error(`Condition "${conditionName}": unsupported intrinsic function or value ${JSON.stringify(node)}`);
	}
};

/**
 * Evaluate every condition of the template.
 *
 * @param {object} template Parsed template
 * @param {object} [parameters={}] Parameter values. Defaults apply to the rest.
 * @returns {Object<string, boolean>} Condition name to result
 */
const evaluateConditions = (template, parameters = {}) => {
	const values = effectiveParameters(template, parameters);
	const definitions = template.Conditions || {};
	const results = {};
	const inProgress = new Set();

	const evaluateNamed = (name) => {
		if (Object.prototype.hasOwnProperty.call(results, name)) {
			return results[name];
		}
		if (!Object.prototype.hasOwnProperty.call(definitions, name)) {
			throw new Error(`Condition "${name}" is not defined in the template`);
		}
		if (inProgress.has(name)) {
			throw new Error(`Condition "${name}" refers to itself`);
		}
		inProgress.add(name);
		const result = evaluateExpression(definitions[name], template, values, evaluateNamed, name);
		inProgress.delete(name);
		if (typeof result !== "boolean") {
			throw new Error(`Condition "${name}" did not evaluate to a boolean`);
		}
		results[name] = result;
		return result;
	};

	for (const name of Object.keys(definitions)) {
		evaluateNamed(name);
	}
	return results;
};

const resolveNode = (node, conditions, parameters) => {
	if (node === null || typeof node !== "object") {
		return node;
	}

	if (Array.isArray(node)) {
		const items = [];
		for (const child of node) {
			const resolved = resolveNode(child, conditions, parameters);
			if (resolved !== NO_VALUE) {
				items.push(resolved);
			}
		}
		return items;
	}

	for (const key of Object.keys(node)) {
		if (key.startsWith("Fn::") && !key.startsWith("Fn::If") && !PASS_THROUGH_FUNCTIONS.has(key)) {
			throw new Error(`Unsupported intrinsic function ${key}`);
		}
	}

	const key = singleKey(node);

	if (key === "Fn::If") {
		const [conditionName, whenTrue, whenFalse] = node["Fn::If"];
		if (!Object.prototype.hasOwnProperty.call(conditions, conditionName)) {
			throw new Error(`Fn::If refers to unknown condition "${conditionName}"`);
		}
		return resolveNode(conditions[conditionName] ? whenTrue : whenFalse, conditions, parameters);
	}

	if (key === "Ref") {
		const name = node.Ref;
		if (name === "AWS::NoValue") {
			return NO_VALUE;
		}
		if (Object.prototype.hasOwnProperty.call(parameters, name)) {
			return parameters[name];
		}
		return { Ref: name };
	}

	const result = {};
	for (const [name, child] of Object.entries(node)) {
		const resolved = resolveNode(child, conditions, parameters);
		if (resolved !== NO_VALUE) {
			result[name] = resolved;
		}
	}
	return result;
};

/**
 * Resolve a node for the given conditions and parameters.
 *
 * Fn::If is replaced by the chosen branch. Ref to AWS::NoValue is removed
 * from lists and objects. Ref to a parameter present in `parameters` is
 * replaced by its value. Other Ref, Sub, and GetAtt nodes stay as they are.
 * The input is not changed.
 *
 * @param {*} node Any node of the parsed template
 * @param {Object<string, boolean>} conditions Result of evaluateConditions()
 * @param {object} [parameters={}] Parameter values to substitute
 * @returns {*} Resolved copy of the node. undefined when the node is AWS::NoValue.
 * @throws {Error} Naming an unsupported intrinsic function or unknown condition
 */
const resolve = (node, conditions, parameters = {}) => {
	const resolved = resolveNode(node, conditions, parameters);
	return resolved === NO_VALUE ? undefined : resolved;
};

/**
 * Resolve one resource of the template.
 *
 * @param {object} template Parsed template
 * @param {string} logicalId Logical ID of the resource
 * @param {object} [parameters={}] Parameter values. Defaults apply to conditions.
 * @returns {object|undefined} Resolved resource, or undefined when its Condition is false
 * @throws {Error} When the resource does not exist
 */
const resolveResource = (template, logicalId, parameters = {}) => {
	const resources = template.Resources || {};
	if (!Object.prototype.hasOwnProperty.call(resources, logicalId)) {
		throw new Error(`Resource "${logicalId}" is not defined in the template`);
	}

	const conditions = evaluateConditions(template, parameters);
	const resource = resources[logicalId];

	if (resource.Condition !== undefined) {
		if (!Object.prototype.hasOwnProperty.call(conditions, resource.Condition)) {
			throw new Error(`Resource "${logicalId}" refers to unknown condition "${resource.Condition}"`);
		}
		if (!conditions[resource.Condition]) {
			return undefined;
		}
	}

	return resolve(resource, conditions, parameters);
};

module.exports = {
	CFN_SCHEMA,
	parseTemplate,
	loadTemplate,
	evaluateConditions,
	resolve,
	resolveResource
};
