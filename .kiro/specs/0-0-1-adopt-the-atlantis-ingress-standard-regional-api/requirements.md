# Requirements: Adopt the Atlantis ingress standard

> **Source**: [PLAN.md](PLAN.md) (Locked, 2026-11-16), derived from [ISSUE.md](ISSUE.md) (GitHub #14)
> **Spec version**: 0-0-1 (from `CHANGELOG.md`, `v0.0.1 (unreleased)`)

## Introduction

This starter deploys an API Gateway REST API and one Lambda function (`WebService`) that uses `@63klabs/cache-data`. Behind an Atlantis CloudFront distribution, the API is edge-optimized and publicly reachable, so the client address in the `RESPONSE` log line is an edge address and a request can skip the distribution.

This change makes the API Regional, fixes the client-address setting at `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, creates an origin secret in every stage, and, when the new parameter `ApiIsBehindCloudFront` is `true`, makes the function answer `401` to any request that did not come through the distribution. The header comparison is done by `@63klabs/cache-data` 1.4.1; the starter adds no comparison code of its own.

The starter is released to end users with everything except `.kiro/specs/0-0-1-*`. Every requirement below that concerns tests therefore keeps its files inside that directory.

## Glossary

- **Starter**: the repository content released to end users, which is everything except `.kiro/specs/0-0-1-*`.
- **Spec directory**: `.kiro/specs/0-0-1-adopt-the-atlantis-ingress-standard-regional-api/`.
- **Flag**: the CloudFormation parameter `ApiIsBehindCloudFront`.
- **Template**: `application-infrastructure/template.yml`.
- **Function**: the `WebService` Lambda function, source in `application-infrastructure/src/lambda/web-service/`.
- **Guard**: the check, in the Function, that refuses a request that is not verified as having come through the distribution.
- **Distribution**: the CloudFront distribution created by the Atlantis network stack, which is maintained outside this repository.
- **Verified request**: a request for which `ClientRequest.isIngressVerified()` returns `true`.
- **Origin secret**: the Secrets Manager secret `${Prefix}-${ProjectId}-${StageId}-OriginSecret`.
- **Spec-local tests**: all tests, test configuration, and test dependencies added by this change, located under the Spec directory.

## Requirements

### Requirement 1: Flag parameter and condition

**User Story:** As an operator, I want one parameter that turns origin enforcement on or off per stage, so that a stage without CloudFront keeps working unchanged.

#### Acceptance Criteria

1. THE Template SHALL define the parameter `ApiIsBehindCloudFront` with type `String`, default `"false"`, and `AllowedValues` of `"true"` and `"false"`.
2. THE Template SHALL list `ApiIsBehindCloudFront` in the `Application Parameters` group of `AWS::CloudFormation::Interface`.
3. THE description of `ApiIsBehindCloudFront` SHALL state that it turns on origin enforcement only, that it does not change the API endpoint type, and that it must be set to `true` only after the network stack sends the origin header.
4. THE Template SHALL define the condition `IsApiBehindCloudFront` as true when `ApiIsBehindCloudFront` equals `"true"`.
5. THE condition name SHALL differ from the parameter name and start with `Is`.
6. THE `template-configuration.json` file SHALL set `ApiIsBehindCloudFront` in its `Parameters` section to the literal `"false"`, with no `$PLACEHOLDER$`, and an operator SHALL change the value by editing that literal in the branch being deployed.

### Requirement 2: Regional API endpoint

**User Story:** As an operator, I want the API to be Regional, so that `sourceIp` is the true viewer address whether a request comes through the Distribution or straight to the API.

#### Acceptance Criteria

1. THE `WebApi` resource SHALL set `EndpointConfiguration` with `Type: REGIONAL` in every deployment, regardless of the Flag.
2. THE Template SHALL NOT make the endpoint type depend on the Flag.
3. THE Template SHALL NOT change the logical ID of `WebApi` or the `execute-api` hostname.
4. THE `ApiIsBehindCloudFront` description and `DEPLOYMENT.md` SHALL state that the starter no longer supports an edge-optimized API, and that an adopter who needs one must change the Template.

### Requirement 3: Client address setting

**User Story:** As an operator, I want the client address to be the address API Gateway recorded, so that a caller cannot choose the address that is logged.

#### Acceptance Criteria

1. THE `WebService` resource SHALL set the environment variable `CACHE_DATA_TRUSTED_PROXY_HOPS` to `"0"` in every stage and for every value of the Flag.
2. THE variable SHALL be defined in the `Environment.Variables` of `WebService` and SHALL NOT be defined in `Globals`.
3. THE Function code SHALL NOT read `X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `X-Atlantis-Origin-Secret`, or `requestContext.identity.sourceIp` directly, and SHALL obtain the client address only through `@63klabs/cache-data`.

### Requirement 4: Origin secret resource

**User Story:** As an operator, I want a generated secret to exist in every stage before enforcement starts, so that the network stack can reference it first.

#### Acceptance Criteria

1. THE Template SHALL define a resource `OriginSecret` of type `AWS::SecretsManager::Secret` with no `Condition`, so it is created in every stage.
2. THE `Name` of `OriginSecret` SHALL be `${Prefix}-${ProjectId}-${StageId}-OriginSecret`.
3. THE value of `OriginSecret` SHALL be generated with `GenerateSecretString` using `PasswordLength: 48` and `ExcludePunctuation: true`, and SHALL be a plain string and not a JSON document.
4. THE Template SHALL NOT expose `OriginSecret` or its value through an `Outputs` entry, an `Export`, a parameter, a `Metadata` entry, an environment variable value, or a log.
5. THE `OriginSecret` SHALL carry the stack's tags and SHALL NOT use a customer-managed KMS key.
6. THE `OriginSecret` SHALL NOT set a `DeletionPolicy` of `Retain`.

### Requirement 5: Function access to the secret when the Flag is true

**User Story:** As an operator, I want the function to be able to read only the origin secret, and only when enforcement is on, so that least privilege holds.

#### Acceptance Criteria

1. WHILE `IsApiBehindCloudFront` is true, THE `WebService` resource SHALL set the environment variable `CACHE_DATA_INGRESS_SECRET_NAME` to the ARN of `OriginSecret` (`!Ref OriginSecret`).
2. WHILE `IsApiBehindCloudFront` is false, THE `WebService` resource SHALL NOT define `CACHE_DATA_INGRESS_SECRET_NAME`.
3. WHILE `IsApiBehindCloudFront` is true, THE `WebServiceLambdaExecutionRole` SHALL include one additional statement with `Sid: LambdaAccessToOriginSecret`, `Effect: Allow`, `Action: secretsmanager:GetSecretValue`, and `Resource` equal to the ARN of `OriginSecret` only.
4. WHILE `IsApiBehindCloudFront` is false, THE `WebServiceLambdaExecutionRole` SHALL NOT include that statement.
5. THE Template SHALL NOT use an AWS managed policy, a wildcard action, or a wildcard resource for this access.
6. THE Template SHALL NOT set `CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS`, so the default of 3600 seconds applies.

### Requirement 6: Guard behavior

**User Story:** As an operator, I want a request that did not come through the Distribution to be refused with a status the Distribution does not rewrite, so that a bypass is visible and not hidden behind a landing page.

#### Acceptance Criteria

1. THE Function SHALL provide the module `utils/ingress-guard.js` exporting `isIngressGuardOn(env)`, `shouldRefuse(clientRequest, env)`, and `buildRefusal(response)`.
2. THE function `isIngressGuardOn(env)` SHALL return `true` only when `env.CACHE_DATA_INGRESS_SECRET_NAME` is a string that is not empty after trimming whitespace.
3. WHEN `isIngressGuardOn(env)` returns `false`, THE `shouldRefuse` function SHALL return `false` and SHALL NOT call any method of `clientRequest`.
4. WHEN `isIngressGuardOn(env)` returns `true`, THE `shouldRefuse` function SHALL return `false` only when `clientRequest.isIngressVerified()` returns exactly `true`.
5. WHEN `isIngressGuardOn(env)` returns `true` AND `clientRequest.isIngressVerified` is missing, is not a function, throws, or returns any value other than `true`, THE `shouldRefuse` function SHALL return `true`.
6. THE `buildRefusal(response)` function SHALL reset the response to status `401`, set the header `Cache-Control` to `no-store` and the header `Expires` to `0` after the reset, set the body to `{ "message": "Requests must use the service endpoint." }`, and return the response object.
7. THE refusal SHALL NOT use status `403` or `404`.
8. THE refusal body and headers SHALL NOT contain the header value sent by the caller, the origin secret, the secret name or ARN, or the reason code.
9. THE Guard SHALL NOT log the origin header, the origin secret, or the secret name or ARN.
10. THE Guard SHALL NOT compare the header with the secret itself; the comparison SHALL be done by `@63klabs/cache-data`.

### Requirement 7: Guard placement in request handling

**User Story:** As a maintainer, I want the guard to run before any routing, validation, or data access, so that an unverified request costs and reveals as little as possible.

#### Acceptance Criteria

1. THE `Routes.process` function in `routes/index.js` SHALL call the Guard immediately after it creates `ClientRequest` and `Response`, and before it calls `isValid()`, selects a route, or calls a controller.
2. WHEN `shouldRefuse` returns `true`, THE `Routes.process` function SHALL return the refusal response without calling `isValid()`, any controller, any service, or any cache access.
3. THE refusal response SHALL be returned to `index.js` and finalized by the existing `response.finalize()` call, so that the `RESPONSE` log line is written.
4. THE `index.js` handler SHALL NOT need a new code path for the Guard.
5. THE Guard SHALL NOT add a call to `ClientRequest.prime()`, because `Config.prime()` already primes the ingress secret through `CachedParameterSecrets.prime()`.
6. WHILE `IsApiBehindCloudFront` is false, THE Function SHALL handle every request exactly as it did before this change.

### Requirement 8: API Gateway execution logging

**User Story:** As a security reviewer, I want the origin secret kept out of API Gateway execution logs, so that it is not stored in CloudWatch.

#### Acceptance Criteria

1. THE `MethodSettings` of `WebApi` SHALL set `DataTraceEnabled` to `False` in a PROD environment.
2. WHILE `IsApiBehindCloudFront` is true, THE `MethodSettings` of `WebApi` SHALL set `DataTraceEnabled` to `False` in every environment.
3. WHILE `IsApiBehindCloudFront` is false AND the environment is not PROD, THE `MethodSettings` of `WebApi` SHALL keep `DataTraceEnabled` as `True`.
4. THE `LoggingLevel`, `MetricsEnabled`, `ResourcePath`, and `HttpMethod` settings, and the condition `ApiGatewayLoggingIsEnabled`, SHALL remain as they are.

### Requirement 9: OpenAPI contract

**User Story:** As an API consumer, I want the `401` response documented, so that I know a request that skips the Distribution is refused.

#### Acceptance Criteria

1. THE `DataResponses` entry in `template-openapi-spec.yml` SHALL include a `'401'` response with the description "Request did not come through the service endpoint" and an `application/json` schema with one string property `message`.
2. THE existing `200`, `304`, and `403` entries SHALL remain.
3. THE change SHALL NOT alter any path, integration, or parameter definition.

### Requirement 10: Dashboard visibility of unverified requests

**User Story:** As an operator, I want unverified requests to appear in the existing error log widget, so that I can see them without a new metric or alarm.

#### Acceptance Criteria

1. THE widget "Error and Warning Log" in `template-dashboard.yml` SHALL be retitled "Error, Warning, and Unverified Request Log".
2. THE query of that widget SHALL also match `loggingType = "INGRESS_UNVERIFIED"` in addition to `ERROR`, `WARN`, and `Task timed out`.
3. THE change SHALL NOT add a widget, a metric filter, a custom metric, an alarm, or an SNS topic.
4. THE change SHALL NOT alter the `Condition: CreateProdResources` on the dashboard.

### Requirement 11: Dependency

**User Story:** As a maintainer, I want the dependency that provides the guard's primitives to be at the required version, so that the Function does not fail at run time.

#### Acceptance Criteria

1. THE `package.json` of the Function SHALL require `@63klabs/cache-data` at `^1.4.1` and `package-lock.json` SHALL lock version 1.4.1 or later.
2. THE `@63klabs/cache-data` bump SHALL be committed before the rest of this change, separately from unrelated `template.yml` edits.
3. THE change SHALL NOT add a production dependency, a dev dependency, a script, or a jest setting to the Function's `package.json`, other than the version bump in criterion 1.

### Requirement 12: Documentation shipped with the Starter

**User Story:** As an adopter, I want the documentation to explain the ingress standard, so that I can adopt it in the right order and undo it.

#### Acceptance Criteria

1. THE `README.md` SHALL list the Regional API, verified ingress, and the origin secret in its feature list.
2. THE `ARCHITECTURE.md` SHALL show the Distribution in the application stack diagram, state that the API is Regional, and add a design decision for origin protection.
3. THE `DEPLOYMENT.md` SHALL describe, for each stage in the order `test`, `beta`, `main`: deploying with the Flag `false`; deploying the network stack with `ApiOriginProtection=true`; then setting the Flag `true` and deploying again; and SHALL warn not to swap the last two steps.
4. THE `DEPLOYMENT.md` SHALL describe rollback (set the Flag `false` and deploy, then deploy the network stack with `ApiOriginProtection=false`), and SHALL state that the secret and the Regional endpoint remain.
5. THE `DEPLOYMENT.md` SHALL describe secret rotation, including the wait for warm functions to reload before changing `ApiOriginSecretRevision`, and the removal of the `AWSPREVIOUS` label afterward.
6. THE `DEPLOYMENT.md` SHALL state: the secret is deleted with the stack and Secrets Manager keeps it for a recovery window, so recreating a stack with the same name can fail; the secret value is readable by anyone with `secretsmanager:GetSecretValue` on it or `cloudfront:GetDistributionConfig` on the Distribution; the origin secret does not authenticate a caller; and the pipeline and network service roles and any permissions boundary must allow the secret actions.
7. THE `DEPLOYMENT.md` SHALL state that the Flag is set per branch and stage by editing the literal `ApiIsBehindCloudFront` value in `application-infrastructure/template-configuration.json`, and that the merge sequence `dev` to `test` to `beta` to `main` carries the value forward, so each stage's value is changed deliberately on its own branch.
8. THE `DEPLOYMENT.md` SHALL state that the dashboard widget exists only in PROD, that TEST stages read the Lambda log group, and that an adopter who wants a dedicated unverified-request widget or metric adds their own.
9. THE `DEPLOYMENT.md` SHALL describe the mixed behavior during a PROD gradual deployment when the Flag is switched.
10. THE `TODO.md` SHALL add one prerequisite line (secret creation permission in the pipeline, and the network stack) and one post-deploy line (the raw URL without the secret returns `401` once the Flag is `true`).
11. THE `CHANGELOG.md` SHALL NOT be modified by this change, so the starter's changelog stays clean for adopters. The Regional endpoint change, including that code reading header names with an exact case needs a check and that `Content-MD5` is passed through, SHALL be stated in `DEPLOYMENT.md` instead.
12. THE `docs/admin-ops/README.md` and `docs/developer/README.md` SHALL replace their `TODO` text with short pages covering the operator view and the guard, and `docs/end-user/README.md` SHALL describe the `401` response in one paragraph.
13. THE steering file `.kiro/steering/atlantis-webapi-node-cache-data.md` SHALL describe the CloudFront topology, correct the handler pattern so that `ClientRequest` and `Response` are created in `Routes.process`, list `CACHE_DATA_TRUSTED_PROXY_HOPS` and `CACHE_DATA_INGRESS_SECRET_NAME`, and state that the Guard runs first in `Routes.process`.
14. NO shipped document SHALL reference the Spec directory, the Spec-local tests, or this change's PLAN, ISSUE, or requirements files.
15. THE `Version:` line in the `template.yml` header SHALL be updated with the patch number and date of this change.

### Requirement 13: Spec-local tests

**User Story:** As a maintainer, I want the tests for this change to prove its behavior without becoming part of the released Starter.

#### Acceptance Criteria

1. ALL new test files SHALL be located under `.kiro/specs/0-0-1-adopt-the-atlantis-ingress-standard-regional-api/tests/`.
2. THE Spec directory SHALL contain `tests/package.json` that declares `jest` at `^30` and `js-yaml` as development dependencies and a `test` script that runs Jest, and `tests/jest.config.js` whose `modulePaths` includes the Function's `node_modules` so the tests and the shipped code load one copy of `@63klabs/cache-data`.
3. THE Spec-local tests SHALL require shipped files by relative path and SHALL NOT copy them.
4. THE Spec-local tests SHALL NOT call AWS; they SHALL stub `isIngressVerified` or use the cache-data test seam.
5. THE file `ingress-guard.test.js` SHALL cover: guard off for unset, empty, and whitespace-only names; guard on for a non-empty name; verified request not refused; unverified request refused; `isIngressVerified` missing, throwing, and returning a non-`true` value refused; flag-off path not consulting `clientRequest`; and the `401` shape using the real `Response` class (status, `Cache-Control: no-store`, `Expires: 0`, content type, body text, and no secret, header value, or reason in the body or headers).
6. THE file `routes-ingress.test.js` SHALL show that, with the guard on and an unverified request, `Routes.process` returns the `401` response and calls no controller, and that, with the guard off, a request routes as before.
7. THE file `no-forwarding-header-parsing.test.js` SHALL read every non-test `.js` file under the Function (excluding `node_modules`), strip comments, and fail on any read of the names listed in Requirement 3, criterion 3.
8. THE file `template.test.js` SHALL parse `template.yml` with `js-yaml` and a schema that accepts the CloudFormation tags in use, and SHALL assert: `WebApi` is `REGIONAL`; `CACHE_DATA_TRUSTED_PROXY_HOPS` is `"0"` on `WebService` and absent from `Globals`; `CACHE_DATA_INGRESS_SECRET_NAME` and the `LambdaAccessToOriginSecret` statement exist only under `IsApiBehindCloudFront`; the statement names only the ARN of `OriginSecret`; `OriginSecret` has no condition, output, or export and uses `GenerateSecretString` with the values in Requirement 4; `DataTraceEnabled` is `False` in PROD and under the condition; and the parameter and condition names and defaults match Requirement 1.
9. THE Spec-local tests SHALL pass when run with `npm test` from the Spec directory's `tests/` directory after `npm install` in the Function directory and in that `tests/` directory.
10. ANY coverage or report output SHALL be written under the Spec directory.

### Requirement 14: Release boundary

**User Story:** As a maintainer, I want the released Starter to stay clean, so that end users receive no test tooling or spec material.

#### Acceptance Criteria

1. THE change SHALL NOT add a test file, jest configuration, test dependency, test script, or test documentation to any path outside the Spec directory.
2. THE change SHALL NOT edit `application-infrastructure/src/lambda/web-service/tests/index.test.js`, `tests/README.md`, or `CHANGELOG.md`.
3. THE change SHALL NOT edit the `buildspec.yml` test steps.
4. THE change SHALL NOT edit `.gitignore` unless a path is needed that is not already ignored, in which case the edit is limited to that path.
5. WHEN the change is ready for release, THE maintainer SHALL review the diff outside `.kiro/specs/0-0-1-*` and confirm it contains no test-related addition.

### Requirement 15: Constraints from the platform

**User Story:** As a platform engineer, I want this change to respect the Atlantis guardrails, so that it deploys through the existing pipeline.

#### Acceptance Criteria

1. THE change SHALL NOT edit upstream Atlantis templates, create pipeline definitions, or add shared infrastructure.
2. ALL new resources SHALL follow `Prefix-ProjectId-StageId-Resource` naming, and all new logical IDs, parameters, and conditions SHALL follow the repository's naming rules.
3. ALL new IAM statements SHALL be scoped to specific actions and resources.
4. THE change SHALL be deployable through the existing CI/CD pipeline without a manual console step, other than the prerequisites in Requirement 12, criterion 6.

## Verification After Deployment

These checks run on deployed stages. They are performed by the maintainer, are read-only, and are not required to implement the change. Each is derived from PLAN.md, section 6.

| # | Check | Where |
|---|-------|-------|
| V1 | `aws apigateway get-rest-api` shows `endpointConfiguration.types` of `REGIONAL`, and a request through the stage succeeds | TEST, then each stage |
| V2 | `sourceIp` in the DEBUG event log is the true sender for a request through the Distribution and for a raw-URL request, each with a forged `X-Forwarded-For` | TEST, Flag `true` |
| V3 | A raw-URL request without the secret returns `401` with `Cache-Control: no-store`, and a request through the Distribution succeeds | TEST, then each stage, after the Flag is set |
| V4 | An `OPTIONS` request to the raw URL carries no data | TEST |
| V5 | The `API-Gateway-Execution-Logs_*` group holds no header values | TEST, `ApiGatewayLoggingEnabled` `TRUE`, Flag `true` |
| V6 | `[INGRESS_UNVERIFIED]` lines appear in the dashboard widget in the expected format | PROD dashboard; TEST reads the Lambda log group |
| V7 | The Spec-local tests pass against the final code | Maintainer's machine, before merging toward `test` |
| V8 | The per-stage Flag value reaches the stack through the literal in `template-configuration.json` (`Parameters.ApiIsBehindCloudFront`) on the branch being deployed | While writing `DEPLOYMENT.md` |

## Out of Scope

- Python starters (starter-00, starter-01): a separate issue.
- A PostDeploy check that the raw URL returns `401`: a separate issue.
- The top client IP dashboard widget (#13): a separate issue, done after this change.
- A metric filter, alarm, or dedicated widget for unverified requests.
- An AWS WAF web ACL, a Lambda authorizer, or disabling the `execute-api` endpoint.
- Changes to the Atlantis network, pipeline, or service-role templates.
- Test files, test tooling, or test documentation inside the released Starter.
- Changes to `CHANGELOG.md`.
- The unrelated uncommitted `template.yml` edits (Parameters and Secrets layer resolved from SSM, removal of `CACHE_DATA_USE_TOOLS_HASH_METHOD`).
