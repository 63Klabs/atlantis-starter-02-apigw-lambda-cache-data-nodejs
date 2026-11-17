/**
 * Tests for the ingress standard changes to template.yml,
 * template-openapi-spec.yml, and template-dashboard.yml
 *
 * Requirements: 1.1 to 1.5, 2.1 to 2.3, 3.1, 3.2, 4.1 to 4.6, 5.1 to 5.6,
 * 8.1 to 8.4, 9.1 to 9.3, 10.1 to 10.4, 13.8
 *
 * template.yml is parsed with js-yaml and a CloudFormation tag schema, then
 * evaluated for each combination of DeployEnvironment (DEV, TEST, PROD) and
 * ApiIsBehindCloudFront ("true", "false"), so the assertions check what
 * CloudFormation would create and not how the template is written.
 *
 * Nothing is read or parsed at load time. The template is loaded and resolved
 * inside each test, so a missing parameter or condition fails only the tests
 * that need it, with a message that names the cause.
 */
const fs = require("fs");

const paths = require("./helpers/paths");
const {
	loadTemplate,
	parseTemplate,
	evaluateConditions,
	resolveResource
} = require("./helpers/cfn-template");

const FLAG_PARAMETER = "ApiIsBehindCloudFront";
const FLAG_CONDITION = "IsApiBehindCloudFront";
const SECRET_STATEMENT_SID = "LambdaAccessToOriginSecret";
const ENVIRONMENTS = ["DEV", "TEST", "PROD"];
const FLAG_VALUES = ["true", "false"];
const COMBINATIONS = ENVIRONMENTS.flatMap((environment) => FLAG_VALUES.map((flag) => [environment, flag]));

let cachedTemplate;

/**
 * Parse template.yml once for the whole file. Called from inside tests only.
 * @returns {object} Parsed template
 */
const getTemplate = () => {
	if (!cachedTemplate) {
		cachedTemplate = loadTemplate();
	}
	return cachedTemplate;
};

/**
 * Throw a clear error when the flag parameter is not declared yet, so every
 * test that needs a flag value fails for the right reason.
 */
const requireFlagParameter = (template) => {
	if (!template.Parameters || !template.Parameters[FLAG_PARAMETER]) {
		throw new Error(`template.yml does not declare the parameter ${FLAG_PARAMETER}, so this combination cannot be evaluated (requirement 1.1)`);
	}
};

/**
 * Parameter values for one combination.
 * ApiGatewayLoggingEnabled is only set when the test needs MethodSettings.
 */
const buildParameters = (environment, flag, extra = {}) => ({
	DeployEnvironment: environment,
	[FLAG_PARAMETER]: flag,
	...extra
});

/**
 * Resolve one resource for a combination of parameter values.
 * @returns {object|undefined} Resolved resource, undefined when its Condition is false
 */
const resolveFor = (logicalId, parameters) => {
	const template = getTemplate();
	requireFlagParameter(template);
	try {
		return resolveResource(template, logicalId, parameters);
	} catch (error) {
		throw new Error(`Could not resolve ${logicalId} for ${JSON.stringify(parameters)}: ${error.message}`);
	}
};

const environmentVariablesOf = (webService) => webService.Properties.Environment.Variables;

const statementsOf = (role) => role.Properties.Policies[0].PolicyDocument.Statement;

describe("template.yml: flag parameter and condition (requirement 1)", () => {

	test("parameter ApiIsBehindCloudFront is a String, defaults to \"false\", and allows only \"true\" and \"false\"", () => {
		const parameter = (getTemplate().Parameters || {})[FLAG_PARAMETER];
		expect(parameter).toBeDefined();
		expect(parameter.Type).toBe("String");
		expect(parameter.Default).toBe("false");
		expect(parameter.AllowedValues).toEqual(["true", "false"]);
	});

	test("parameter is listed in the Application Parameters group", () => {
		const groups = getTemplate().Metadata["AWS::CloudFormation::Interface"].ParameterGroups;
		const group = groups.find((candidate) => candidate.Label && candidate.Label.default === "Application Parameters");
		expect(group).toBeDefined();
		expect(group.Parameters).toContain(FLAG_PARAMETER);
	});

	test("parameter description covers enforcement only, the endpoint type, the origin header, and edge-optimized APIs", () => {
		const parameter = (getTemplate().Parameters || {})[FLAG_PARAMETER];
		expect(parameter).toBeDefined();
		const description = parameter.Description;
		expect(description).toMatch(/origin/i);
		expect(description).toMatch(/endpoint type/i);
		expect(description).toMatch(/network stack|X-Atlantis-Origin-Secret/i);
		expect(description).toMatch(/edge-optimized/i);
	});

	test("condition name starts with Is and differs from the parameter name", () => {
		const conditions = getTemplate().Conditions || {};
		expect(Object.keys(conditions)).toContain(FLAG_CONDITION);
		expect(FLAG_CONDITION).not.toBe(FLAG_PARAMETER);
		expect(FLAG_CONDITION.startsWith("Is")).toBe(true);
	});

	test.each(FLAG_VALUES)("condition IsApiBehindCloudFront is true exactly when the flag is \"true\" (flag %s)", (flag) => {
		const template = getTemplate();
		requireFlagParameter(template);
		const conditions = evaluateConditions(template, buildParameters("TEST", flag));
		expect(conditions[FLAG_CONDITION]).toBe(flag === "true");
	});

});

describe.each(COMBINATIONS)("template.yml with DeployEnvironment %s and ApiIsBehindCloudFront %s", (environment, flag) => {

	const isFlagOn = flag === "true";

	test("condition IsApiBehindCloudFront follows the flag", () => {
		const template = getTemplate();
		requireFlagParameter(template);
		const conditions = evaluateConditions(template, buildParameters(environment, flag));
		expect(conditions[FLAG_CONDITION]).toBe(isFlagOn);
	});

	test("WebApi endpoint type is REGIONAL (requirements 2.1, 2.2)", () => {
		const webApi = resolveFor("WebApi", buildParameters(environment, flag));
		expect(webApi.Properties.EndpointConfiguration).toEqual({ Type: "REGIONAL" });
	});

	test("WebApi keeps its logical ID and type (requirement 2.3)", () => {
		const webApi = resolveFor("WebApi", buildParameters(environment, flag));
		expect(webApi.Type).toBe("AWS::Serverless::Api");
	});

	test("WebService sets CACHE_DATA_TRUSTED_PROXY_HOPS to \"0\" (requirement 3.1)", () => {
		const webService = resolveFor("WebService", buildParameters(environment, flag));
		expect(environmentVariablesOf(webService).CACHE_DATA_TRUSTED_PROXY_HOPS).toBe("0");
	});

	test("WebService sets CACHE_DATA_INGRESS_SECRET_NAME to the OriginSecret ARN only when the flag is true (requirements 5.1, 5.2)", () => {
		const webService = resolveFor("WebService", buildParameters(environment, flag));
		const variables = environmentVariablesOf(webService);
		if (isFlagOn) {
			expect(variables.CACHE_DATA_INGRESS_SECRET_NAME).toEqual({ Ref: "OriginSecret" });
		} else {
			expect(variables).not.toHaveProperty("CACHE_DATA_INGRESS_SECRET_NAME");
		}
	});

	test("WebService does not set CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS (requirement 5.6)", () => {
		const webService = resolveFor("WebService", buildParameters(environment, flag));
		expect(environmentVariablesOf(webService)).not.toHaveProperty("CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS");
	});

	test("execution role has the LambdaAccessToOriginSecret statement only when the flag is true (requirements 5.3, 5.4)", () => {
		const role = resolveFor("WebServiceLambdaExecutionRole", buildParameters(environment, flag));
		const matching = statementsOf(role).filter((statement) => statement.Sid === SECRET_STATEMENT_SID);

		if (!isFlagOn) {
			expect(matching).toHaveLength(0);
			return;
		}

		expect(matching).toHaveLength(1);
		const [statement] = matching;
		expect(statement.Effect).toBe("Allow");
		expect([].concat(statement.Action)).toEqual(["secretsmanager:GetSecretValue"]);
		expect(statement.Resource).toEqual({ Ref: "OriginSecret" });
	});

	test("the secret statement has no wildcard (requirement 5.5)", () => {
		const role = resolveFor("WebServiceLambdaExecutionRole", buildParameters(environment, flag));
		const statement = statementsOf(role).find((candidate) => candidate.Sid === SECRET_STATEMENT_SID);
		if (!isFlagOn) {
			expect(statement).toBeUndefined();
			return;
		}
		expect(statement).toBeDefined();
		expect(JSON.stringify(statement)).not.toContain("*");
	});

	test("execution role managed policies are unchanged (requirement 5.5)", () => {
		const role = resolveFor("WebServiceLambdaExecutionRole", buildParameters(environment, flag));
		expect(role.Properties.ManagedPolicyArns).toEqual([
			"arn:aws:iam::aws:policy/CloudWatchLambdaInsightsExecutionRolePolicy",
			"arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess",
			{ "Fn::ImportValue": { "Fn::Sub": "${Prefix}-CacheDataManagedLambdaExecutionRolePolicy" } }
		]);
	});

	test("OriginSecret is created (requirement 4.1)", () => {
		const secret = resolveFor("OriginSecret", buildParameters(environment, flag));
		expect(secret).toBeDefined();
		expect(secret.Type).toBe("AWS::SecretsManager::Secret");
	});

	test("DataTraceEnabled is false in PROD and when the flag is true, and true otherwise (requirements 8.1 to 8.3)", () => {
		const webApi = resolveFor("WebApi", buildParameters(environment, flag, { ApiGatewayLoggingEnabled: "TRUE" }));
		const [methodSettings] = webApi.Properties.MethodSettings;
		const expected = !(environment === "PROD" || isFlagOn);
		expect(methodSettings.DataTraceEnabled).toBe(expected);
	});

	test("other MethodSettings are unchanged (requirement 8.4)", () => {
		const webApi = resolveFor("WebApi", buildParameters(environment, flag, { ApiGatewayLoggingEnabled: "TRUE" }));
		expect(webApi.Properties.MethodSettings).toHaveLength(1);
		const [methodSettings] = webApi.Properties.MethodSettings;
		expect(methodSettings.LoggingLevel).toBe(environment === "PROD" ? "ERROR" : "INFO");
		expect(methodSettings.ResourcePath).toBe("/*");
		expect(methodSettings.HttpMethod).toBe("*");
		expect(methodSettings.MetricsEnabled).toBe(true);
	});

	test("API Gateway logging stays controlled by ApiGatewayLoggingEnabled (requirement 8.4)", () => {
		const off = resolveFor("WebApi", buildParameters(environment, flag, { ApiGatewayLoggingEnabled: "FALSE" }));
		expect(off.Properties).not.toHaveProperty("MethodSettings");
		expect(off.Properties).not.toHaveProperty("AccessLogSetting");

		const on = resolveFor("WebApi", buildParameters(environment, flag, { ApiGatewayLoggingEnabled: "TRUE" }));
		expect(on.Properties.MethodSettings).toBeDefined();
		expect(on.Properties.AccessLogSetting).toBeDefined();
	});

});

describe("template.yml: OriginSecret and exposure (requirements 3.2, 4.1 to 4.6)", () => {

	const getSecret = () => getTemplate().Resources.OriginSecret;

	test("OriginSecret exists, has no Condition, and is a Secrets Manager secret", () => {
		const secret = getSecret();
		expect(secret).toBeDefined();
		expect(secret.Type).toBe("AWS::SecretsManager::Secret");
		expect(secret).not.toHaveProperty("Condition");
	});

	test("OriginSecret is named Prefix-ProjectId-StageId-OriginSecret", () => {
		expect(getSecret().Properties.Name).toEqual({ "Fn::Sub": "${Prefix}-${ProjectId}-${StageId}-OriginSecret" });
	});

	test("OriginSecret is a generated plain string of 48 characters without punctuation", () => {
		const properties = getSecret().Properties;
		expect(properties.GenerateSecretString.PasswordLength).toBe(48);
		expect(properties.GenerateSecretString.ExcludePunctuation).toBe(true);
		expect(properties.GenerateSecretString).not.toHaveProperty("SecretStringTemplate");
		expect(properties.GenerateSecretString).not.toHaveProperty("GenerateStringKey");
		expect(properties).not.toHaveProperty("SecretString");
	});

	test("OriginSecret uses the default key and is not retained", () => {
		const secret = getSecret();
		expect(secret.Properties).not.toHaveProperty("KmsKeyId");
		expect(secret.DeletionPolicy).not.toBe("Retain");
		expect(secret.UpdateReplacePolicy).not.toBe("Retain");
	});

	test.each(["Outputs", "Parameters", "Metadata", "Conditions", "Mappings"])("section %s does not mention OriginSecret", (section) => {
		expect(JSON.stringify(getTemplate()[section] || {})).not.toContain("OriginSecret");
	});

	test("no Export anywhere in the template refers to OriginSecret", () => {
		const exportedValues = [];
		for (const output of Object.values(getTemplate().Outputs || {})) {
			if (output.Export) {
				exportedValues.push(JSON.stringify(output));
			}
		}
		for (const value of exportedValues) {
			expect(value).not.toContain("OriginSecret");
		}
	});

	test("Globals does not set CACHE_DATA_TRUSTED_PROXY_HOPS or any ingress variable (requirement 3.2)", () => {
		const globals = JSON.stringify(getTemplate().Globals || {});
		expect(globals).not.toContain("CACHE_DATA_TRUSTED_PROXY_HOPS");
		expect(globals).not.toContain("CACHE_DATA_INGRESS_SECRET_NAME");
	});

	test("the secret is not passed as an environment variable value other than the ARN reference", () => {
		const variables = environmentVariablesOf(getTemplate().Resources.WebService);
		const mentions = Object.entries(variables).filter(([, value]) => JSON.stringify(value).includes("OriginSecret"));
		expect(mentions.map(([name]) => name)).toEqual(["CACHE_DATA_INGRESS_SECRET_NAME"]);
	});

});

describe("template.yml: no metric filter or new alarm (requirement 10.3)", () => {

	test("template.yml contains no AWS::Logs::MetricFilter", () => {
		const text = fs.readFileSync(paths.template, "utf8");
		expect(text).not.toContain("AWS::Logs::MetricFilter");
	});

});

describe("template-openapi-spec.yml (requirement 9)", () => {

	const getSpec = () => parseTemplate(fs.readFileSync(paths.openApiSpec, "utf8"), paths.openApiSpec);

	test("DataResponses has a '401' entry and keeps '200', '304', and '403'", () => {
		const responses = getSpec().components.schemas.DataResponses;
		expect(Object.keys(responses)).toEqual(["200", "304", "401", "403"]);
		expect(responses["401"]).toEqual({ $ref: "#/components/schemas/401" });
	});

	test("a '401' schema fragment sits beside the '304' and '403' fragments", () => {
		const schemas = getSpec().components.schemas;
		expect(schemas).toHaveProperty("304");
		expect(schemas).toHaveProperty("403");
		expect(schemas).toHaveProperty("401");

		const fragment = schemas["401"];
		expect(fragment.description).toBe("Request did not come through the service endpoint");
		const schema = fragment.content["application/json"].schema;
		expect(schema.type).toBe("object");
		expect(Object.keys(schema.properties)).toEqual(["message"]);
		expect(schema.properties.message.type).toBe("string");
	});

	test("the '401' entry and fragment appear as text in the file", () => {
		const text = fs.readFileSync(paths.openApiSpec, "utf8");
		expect(text).toMatch(/^\s+'401':\s*\n\s+\$ref: '#\/components\/schemas\/401'/m);
		expect(text).toMatch(/^\s+'401':\s*\n\s+description:/m);
	});

	test("paths and integrations are untouched (requirement 9.3)", () => {
		const spec = getSpec();
		expect(Object.keys(spec.paths)).toEqual(["/api/example/", "/api/example/{id}"]);
		for (const pathItem of Object.values(spec.paths)) {
			expect(pathItem.get.responses).toEqual({ $ref: "#/components/schemas/DataResponses" });
			expect(pathItem.get["x-amazon-apigateway-integration"].type).toBe("aws_proxy");
		}
	});

});

describe("template-dashboard.yml (requirement 10)", () => {

	const getText = () => fs.readFileSync(paths.dashboard, "utf8");

	test("the widget is retitled Error, Warning, and Unverified Request Log (requirement 10.1)", () => {
		const text = getText();
		expect(text).toContain("\"title\": \"Error, Warning, and Unverified Request Log\"");
		expect(text).not.toContain("\"title\": \"Error and Warning Log\"");
	});

	test("the widget query also matches INGRESS_UNVERIFIED and keeps ERROR, WARN, and Task timed out (requirement 10.2)", () => {
		const queryLines = getText().split("\n").filter((line) => line.includes("Task timed out"));
		expect(queryLines).toHaveLength(1);
		const [query] = queryLines;
		expect(query).toContain("loggingType = \\\"INGRESS_UNVERIFIED\\\"");
		expect(query).toContain("loggingType = \\\"ERROR\\\"");
		expect(query).toContain("loggingType = \\\"WARN\\\"");
	});

	test("INGRESS_UNVERIFIED appears only in that widget query (requirement 10.3)", () => {
		const lines = getText().split("\n").filter((line) => line.includes("INGRESS_UNVERIFIED"));
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("Task timed out");
	});

	test("the dashboard keeps Condition: CreateProdResources and adds no metric filter or alarm (requirements 10.3, 10.4)", () => {
		const text = getText();
		expect(text).toMatch(/^\s+Condition: CreateProdResources\s*$/m);
		expect(text).not.toContain("AWS::Logs::MetricFilter");
		expect(text).not.toContain("AWS::CloudWatch::Alarm");
		expect(text).not.toContain("AWS::SNS::Topic");
	});

});

describe("template-configuration.json (requirement 1.6)", () => {

	const getConfiguration = () => JSON.parse(fs.readFileSync(paths.templateConfiguration, "utf8"));

	test("Parameters.ApiIsBehindCloudFront is the literal string \"false\" with no placeholder", () => {
		const value = getConfiguration().Parameters[FLAG_PARAMETER];
		expect(value).toBe("false");
		expect(typeof value).toBe("string");
		expect(value).not.toContain("$");
	});

	test("the other Parameters keys and values are unchanged", () => {
		const { [FLAG_PARAMETER]: flagValue, ...others } = getConfiguration().Parameters;
		expect(flagValue).toBeDefined();
		expect(others).toEqual({
			UserAgent: "Web Service - $STAGE_ID$",
			ApiPathBase: "$PROJECT_ID$-$STAGE_ID$",
			FunctionMaxMemoryInMB: "2048",
			FunctionTimeOutInSeconds: "10",
			ApiGatewayLoggingEnabled: "FALSE",
			CacheDataS3BucketName: "",
			CacheDataDynamoDbTableName: ""
		});
	});

	test("the flag directly follows ApiGatewayLoggingEnabled", () => {
		const keys = Object.keys(getConfiguration().Parameters);
		expect(keys[keys.indexOf("ApiGatewayLoggingEnabled") + 1]).toBe(FLAG_PARAMETER);
	});

	test("the configured value is allowed by the template parameter", () => {
		const allowed = getTemplate().Parameters[FLAG_PARAMETER].AllowedValues;
		expect(allowed).toContain(getConfiguration().Parameters[FLAG_PARAMETER]);
	});

});
