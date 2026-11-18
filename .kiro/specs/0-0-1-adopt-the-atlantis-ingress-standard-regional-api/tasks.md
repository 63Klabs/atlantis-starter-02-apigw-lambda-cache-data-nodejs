# Tasks: Adopt the Atlantis ingress standard

> **Requirements**: [requirements.md](requirements.md)
> **Design**: [design.md](design.md)

## Ground rules for every task

- Add tests, test tooling, and test notes only under `.kiro/specs/0-0-1-adopt-the-atlantis-ingress-standard-regional-api/tests/` (requirements 13 and 14).
- Do not edit `CHANGELOG.md`, `buildspec.yml`, `.gitignore`, `index.js`, `utils/index.js`, `tests/index.test.js`, or `tests/README.md` under the function directory.
- No shipped document mentions the spec directory or the spec-local tests (requirement 12.14).
- Use tabs in JavaScript files under the function directory, as the existing files do.
- Do not run `sam deploy`, any `aws` write command, or any command that touches a deployed stage.
- In this file, `SPEC` is the spec directory and `FN` is `application-infrastructure/src/lambda/web-service`.

## Tasks

- [x] 1. Confirm the starting point
  - [x] 1.1 Confirm the `@63klabs/cache-data` `^1.4.1` bump is committed
    - Run `git status --short` and `git diff HEAD -- application-infrastructure/src/lambda/web-service/package.json application-infrastructure/src/lambda/web-service/package-lock.json`.
    - If the bump is still uncommitted, stop and ask the maintainer to commit it on its own, apart from the unrelated `template.yml` edits (Parameters and Secrets layer, removed `CACHE_DATA_USE_TOOLS_HASH_METHOD`). Do not commit for them.
    - Confirm `FN/node_modules/@63klabs/cache-data/package.json` reports version 1.4.1 or later, and run `npm install` in `FN` if `node_modules` is missing.
    - _Requirements: 11.1, 11.2_
  - [x] 1.2 Record the baseline
    - Run `npm test` in `FN` and note that it passes before any change.
    - _Requirements: 14.2_

- [x] 2. Set up the spec-local test package
  - [x] 2.1 Create the tooling files under `SPEC/tests/`
    - `package.json` exactly as in design section 8.2 (`private`, `engines`, `test` script, `jest` `^30.5.2`, `js-yaml` `^4.1.0`).
    - `jest.config.js` exactly as in design section 8.2, with `modulePaths` pointing at `FN/node_modules` and `testMatch` limited to `<rootDir>/*.test.js`.
    - `.gitignore` containing `node_modules/` and `coverage/`.
    - Run `npm install` in `SPEC/tests/` and keep the generated `package-lock.json`.
    - _Requirements: 13.1, 13.2, 13.10, 14.1_
  - [x] 2.2 Create the helpers under `SPEC/tests/helpers/`
    - `paths.js`: absolute paths to `template.yml`, `template-openapi-spec.yml`, `template-dashboard.yml`, `FN`, `FN/utils/ingress-guard.js`, and `FN/routes/index.js`, resolved from `__dirname`.
    - `events.js`: a function that returns a minimal API Gateway proxy event (`httpMethod`, `path`, `resource`, `headers`, `queryStringParameters`, `pathParameters`, `requestContext.identity.sourceIp` with an RFC 5737 address, `requestId`, `resourcePath`) and a context with `getRemainingTimeInMillis` and `awsRequestId`. Accept overrides for the path, resource, and headers.
    - `cfn-template.js`: the CloudFormation-tag schema for `js-yaml` (`Ref`, `Sub`, `GetAtt`, `If`, `Equals`, `Not`, `And`, `Or`, `FindInMap`, `Condition`, `ImportValue`, `Join`) converting short tags to long form; `loadTemplate()`, `evaluateConditions(template, parameters)`, `resolve(node, conditions, parameters)`, and `resolveResource(template, logicalId, parameters)` as in design section 8.3. An unknown tag or unsupported intrinsic function must throw an error that names it.
    - _Requirements: 13.1, 13.3, 13.8_

- [x] 3. Write the tests first (they fail until tasks 4 to 7 are done)
  - [x] 3.1 Write `SPEC/tests/ingress-guard.test.js`
    - Cover every row of the table in design section 8.4 for `ingress-guard.test.js`, using a real `ClientRequest` and `Response` from `@63klabs/cache-data` for the `buildRefusal` cases and plain doubles for the `shouldRefuse` cases.
    - In `beforeEach` and `afterEach`, save and restore `AWS_REGION` and `CACHE_DATA_INGRESS_SECRET_NAME`.
    - The refusal-content case sends a header value and a secret name through the request and asserts neither appears in the serialized response.
    - Require the guard with `require(paths.ingressGuard)`.
    - _Requirements: 6.1 to 6.10, 13.4, 13.5_
  - [x] 3.2 Write `SPEC/tests/routes-ingress.test.js`
    - Use `jest.mock` with the literal relative path to `FN/controllers` so `ExampleCtrl.get` is a `jest.fn()`.
    - Cover the four cases in design section 8.4 for `routes-ingress.test.js`. For the verified case, use `jest.spyOn(ClientRequest.prototype, 'isIngressVerified').mockReturnValue(true)`. For the invalid-path case, assert the status is `401` and not `400`.
    - Restore all spies and environment variables after each test.
    - _Requirements: 7.1, 7.2, 7.3, 7.6, 13.4, 13.6_
  - [x] 3.3 Write `SPEC/tests/no-forwarding-header-parsing.test.js`
    - Walk `FN` for `.js` files, excluding `node_modules`, `tests`, and `coverage`. Strip block and line comments. Fail on any of: `x-forwarded-for`, `cloudfront-viewer-address`, `x-real-ip`, `x-atlantis-origin-secret`, a `forwarded` header name, or `identity.sourceip` (compare in lower case). No file is allow-listed.
    - Assert the scanned file list is not empty and includes `routes/index.js` and `utils/ingress-guard.js`.
    - _Requirements: 3.3, 13.7_
  - [x] 3.4 Write `SPEC/tests/template.test.js`
    - Run every assertion in the design section 8.4 table for `template.test.js` across `DeployEnvironment` `DEV`, `TEST`, `PROD` and `ApiIsBehindCloudFront` `"true"`, `"false"`, using `ApiGatewayLoggingEnabled` `"TRUE"` for the `DataTraceEnabled` assertions.
    - Add the text checks: `template-openapi-spec.yml` has a `'401'` entry under `DataResponses` and a `'401'` schema fragment alongside the existing `'200'`, `'304'`, `'403'` entries; `template-dashboard.yml` has the new widget title and the `INGRESS_UNVERIFIED` filter; `template.yml` contains no `AWS::Logs::MetricFilter`.
    - _Requirements: 1.1 to 1.5, 2.1 to 2.3, 3.1, 3.2, 4.1 to 4.6, 5.1 to 5.6, 8.1 to 8.4, 9.1 to 9.3, 10.1 to 10.4, 13.8_
  - [x] 3.5 Run the new tests and confirm they fail for the right reasons
    - Run `npm test` in `SPEC/tests/`. The guard, routes, and template tests must fail because the code and template do not exist yet, not because of a setup error. Fix any setup error (paths, `modulePaths`, tag schema) before continuing.
    - _Requirements: 13.9_

- [x] 4. Implement the function code
  - [x] 4.1 Create `FN/utils/ingress-guard.js`
    - Implement `isIngressGuardOn(env)`, `shouldRefuse(clientRequest, env)`, and `buildRefusal(response)` as in design section 5.1, with JSDoc, tab indentation, and the module comment.
    - The module must not log, must not read any header, and must not call AWS.
    - _Requirements: 6.1 to 6.10_
  - [x] 4.2 Edit `FN/routes/index.js`
    - Add `const IngressGuard = require("../utils/ingress-guard");` next to the controllers import.
    - Make the guard the first statement inside the existing `try` block: `if (IngressGuard.shouldRefuse(REQ)) { return IngressGuard.buildRefusal(RESP); }`. Do not change any other line.
    - _Requirements: 7.1 to 7.6_
  - [x] 4.3 Run the guard, routes, and source-scan tests
    - Run `npm test` in `SPEC/tests/`. `ingress-guard`, `routes-ingress`, and `no-forwarding-header-parsing` must pass. `template` is expected to still fail.
    - Run `npm test` in `FN` and confirm the existing tests still pass.
    - _Requirements: 3.3, 6.1 to 6.10, 7.1 to 7.6, 13.9_

- [x] 5. Edit the templates
  - [x] 5.1 Edit `application-infrastructure/template.yml`
    - Add the parameter `ApiIsBehindCloudFront` after `ApiGatewayLoggingEnabled` and list it in the `Application Parameters` group (design 3.1).
    - Add the conditions `IsApiBehindCloudFront` and `UseApiDataTrace` (design 3.2).
    - Add `EndpointConfiguration: Type: REGIONAL` to `WebApi` and change `DataTraceEnabled` to `!If [UseApiDataTrace, True, False]` (design 3.3).
    - Add the `OriginSecret` resource in a new `Secrets` comment block (design 3.4).
    - Add `CACHE_DATA_TRUSTED_PROXY_HOPS: "0"` and the conditional `CACHE_DATA_INGRESS_SECRET_NAME` to `WebService` `Environment.Variables` (design 3.5).
    - Add the conditional `LambdaAccessToOriginSecret` statement to the role's inline policy (design 3.6).
    - Update the `Version:` header line with the next patch number and today's date (design 3.7).
    - Do not touch the unrelated working-tree edits (layer resolution, removed hash variable) or rename any logical ID.
    - _Requirements: 1.1 to 1.5, 2.1 to 2.3, 3.1, 3.2, 4.1 to 4.6, 5.1 to 5.6, 8.1 to 8.4, 12.15, 15.1 to 15.3_
  - [x] 5.2 Edit `application-infrastructure/template-openapi-spec.yml`
    - Add `'401'` to `DataResponses` between `'304'` and `'403'`, and add the `'401'` schema fragment (design 4). Change nothing else.
    - _Requirements: 9.1 to 9.3_
  - [x] 5.3 Edit `application-infrastructure/template-dashboard.yml`
    - Change the title of the "Error and Warning Log" widget to "Error, Warning, and Unverified Request Log" and add `or loggingType = \"INGRESS_UNVERIFIED\"` to its filter (design 6). Keep the JSON escaping of the surrounding query string. Add nothing else.
    - _Requirements: 10.1 to 10.4_
  - [x] 5.4 Run all spec-local tests
    - Run `npm test` in `SPEC/tests/`. Every test file must pass. If the template test fails on a real mismatch, fix the template, not the test, unless the test contradicts the requirements.
    - _Requirements: 13.9_
  - [x] 5.5 Validate the template syntax with read-only tools
    - If `cfn-lint` is installed, run it on `template.yml` and fix anything the change introduced. If `sam` is installed, run `sam validate --lint -t application-infrastructure/template.yml` from the repository root. Neither command deploys anything. If neither tool is installed, say so in the task summary and rely on the template test.
    - _Requirements: 15.4_

- [x] 6. Read the SAM configuration documentation for the per-stage flag
  - [x] 6.1 Confirm how a stage's parameter override is set
    - Outcome: the documentation search found no documented route from a stage's `samconfig` `parameter_overrides` to an application-stack parameter, so the maintainer was asked. The maintainer confirmed the mechanism: `ApiIsBehindCloudFront` is a literal value in the `Parameters` section of `application-infrastructure/template-configuration.json`. It is not an environment-variable placeholder, so it has no `$PLACEHOLDER$`. The `samconfig` `parameter_overrides` mechanism is not the way to set it. Users may load SSM parameters or other configuration themselves, but the starter does not provide that.
    - Done: `template-configuration.json` now sets `"ApiIsBehindCloudFront": "false"` directly after `"ApiGatewayLoggingEnabled": "FALSE"`, and `SPEC/tests/template.test.js` asserts it.
    - For task 7.1: an operator changes the value by editing that literal in the branch being deployed. The merge sequence `dev` to `test` to `beta` to `main` carries the value forward, so each stage's value is changed deliberately on its own branch. Include the caution that setting `"true"` on a branch and then merging forward also switches the next stage, so roll out stage by stage.
    - _Requirements: 12.7 (check V8)_

- [x] 7. Write the shipped documentation
  - [x] 7.1 Edit `DEPLOYMENT.md`
    - Add the section "CloudFront ingress and origin protection" with every item listed for `DEPLOYMENT.md` in design section 7, the adoption order, rollback, rotation, and the per-stage flag steps from task 6.1: the flag is a literal in `application-infrastructure/template-configuration.json` (`Parameters.ApiIsBehindCloudFront`, default `"false"`, no placeholder), changed by editing it on the branch being deployed; the merge sequence `dev` to `test` to `beta` to `main` carries the value forward, so state the caution to roll out stage by stage because merging a `"true"` forward also switches the next stage. State that the starter's API is always Regional and what an existing stage should check (exact-case header names, `Content-MD5`).
    - _Requirements: 2.4, 12.3 to 12.9, 12.11_
  - [x] 7.2 Edit `README.md`, `ARCHITECTURE.md`, and `TODO.md`
    - `README.md`: feature list lines (requirement 12.1).
    - `ARCHITECTURE.md`: update the mermaid diagram to show the distribution and the secret, add `utils/ingress-guard.js` to the directory tree, add the design decisions (requirement 12.2).
    - `TODO.md`: one prerequisite line and one post-deploy line (requirement 12.10).
    - _Requirements: 12.1, 12.2, 12.10_
  - [x] 7.3 Edit the three `docs/` pages
    - Replace the `TODO` text in `docs/admin-ops/README.md`, `docs/developer/README.md`, and `docs/end-user/README.md` with the content listed in design section 7. Keep each page short.
    - _Requirements: 12.12_
  - [x] 7.4 Edit `.kiro/steering/atlantis-webapi-node-cache-data.md`
    - Add the CloudFront topology note under "Required Infrastructure". Replace the handler-pattern code sample with the real shape (the handler delegates to `Routes.process(event, context)`, which creates `ClientRequest` and `Response`). Correct the routing example to match. Add the two environment variable rows. Add the rule that the guard runs first in `Routes.process`. Leave other rows and sections alone.
    - _Requirements: 12.13_
  - [x] 7.5 Check the shipped documents for forbidden references
    - Search the files edited in tasks 7.1 to 7.4 for `.kiro/specs`, `0-0-1`, `PLAN`, `ISSUE`, `requirements.md`, and `spec-local`. There must be no match.
    - _Requirements: 12.14_

- [x] 8. Final checks
  - [x] 8.1 Run the whole local test set one last time
    - Run `npm test` in `SPEC/tests/` and in `FN`. Both must pass.
    - _Requirements: 13.9_
  - [x] 8.2 Check the release boundary
    - Run `git status --short` and `git diff --stat`. List every changed or new path outside `.kiro/specs/0-0-1-*`.
    - The only paths allowed outside the spec directory are those listed in design section 2. Confirm none is a test file, test configuration, test dependency, or test note, that `CHANGELOG.md`, `buildspec.yml`, `.gitignore`, `FN/index.js`, `FN/utils/index.js`, `FN/tests/index.test.js`, and `FN/tests/README.md` are unchanged, and that `FN/package.json` differs from `HEAD` only by the cache-data version (task 1.1). Report any exception.
    - Result: one exception, left open on purpose. `CHANGELOG.md` differs from the parent commit `4ef32e0` in commit `55adf78` (the intro prose only: heading `Change Log` to `Changelog`, an intro sentence naming "the Atlantis with Kiro AI assets", and a Keep a Changelog paragraph; no entry was added). Requirements 12.11 and 14.2 say this change must not modify it. Maintainer decision: restore it with `git checkout 4ef32e0 -- CHANGELOG.md` or accept the edit. Every other check passed.
    - _Requirements: 11.3, 14.1 to 14.5_
  - [x] 8.3 Confirm nothing sensitive or deploying was added
    - Search the diff for a hard-coded secret value, an account ID, or a real ARN. Confirm `template.yml` has no `Outputs` or `Export` for `OriginSecret` and that no `*` appears in the new IAM statement.
    - _Requirements: 4.4, 5.5, 15.1 to 15.3_
  - [x] 8.4 Write the task summary
    - State what changed, which checks were run and their results, which tools were not available, and that the post-deploy checks V1 to V6 and V8 (requirements document) are still to be run by the maintainer.
    - _Requirements: all_

## Maintainer checks after deployment (not part of the implementation tasks)

These need deployed stages. The agent does not run them. Each is defined in the requirements, section "Verification After Deployment".

- [ ] V1 The API is Regional and a request through the stage succeeds (TEST, then each stage).
- [ ] V2 `sourceIp` is the true sender on both paths, with a forged `X-Forwarded-For` (TEST, flag `true`).
- [ ] V3 The raw URL without the secret returns `401` with `Cache-Control: no-store`, and a request through the distribution succeeds (each stage, after the flag is set).
- [x] V4 An `OPTIONS` request to the raw URL carries no data (TEST).
  - Result (PASS, 2026-11-17, TEST, raw URL `.../tst-app-start-02-test/api/example/` and `.../example/1`): five `OPTIONS` requests (no headers; `Origin` + `Access-Control-Request-Method: GET` + `Access-Control-Request-Headers`; `Origin` only; `Access-Control-Request-Method: POST`; sub-path). Every response was `200`, `content-type: application/json`, body `{}` (3 bytes), with only the CORS headers set by `WebApi` `Cors` (`access-control-allow-origin: *`, `access-control-allow-methods: GET,OPTIONS`, `access-control-allow-headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token`, `access-control-max-age: 86400`) plus API Gateway's own `x-amzn-requestid`, `x-amz-apigw-id`, `x-amzn-trace-id`. No application data, no secret or internal header value, and no `Origin` echo.
- [ ] V5 The `API-Gateway-Execution-Logs_*` group holds no header values (TEST, logging enabled, flag `true`).
- [ ] V6 `[INGRESS_UNVERIFIED]` lines appear in the dashboard widget (PROD dashboard; TEST reads the Lambda log group).
- [x] V7 The spec-local tests pass against the final code on the maintainer's machine, before merging toward `test`.
  - Result (PASS): `npm test` in `SPEC/tests/` ran 4 suites and 188 tests, all passed. `npm test` in `FN` ran 1 suite and 19 tests, all passed. `git status --short` showed changes only inside the spec directory (`tasks.md`, `tasks.meta.json`), so the code under test is the committed code.
- [x] V8 The per-stage flag value reaches the stack through the literal in `template-configuration.json` on the branch being deployed (confirmed by the maintainer in task 6.1 and written in `DEPLOYMENT.md`).
  - Result (PASS, 2026-11-17, mechanism check): `template-configuration.json` on `dev` and on `test` (both at commit `55adf78`) holds the plain literal `"ApiIsBehindCloudFront": "false"` with no `$PLACEHOLDER$`. `update_template_configuration.py` only replaces `$NAME$` tokens from environment variables, so the literal passes through unchanged. The deployed stack `acme-tst-app-start-02-test-application` (us-east-2, `CREATE_COMPLETE`) has `ApiIsBehindCloudFront` = `false`, matching the file. The `acme-tst-app-start-02-test-pipeline` CloudFormation action `ParameterOverrides` does not list `ApiIsBehindCloudFront` and it reads the file through `TemplateConfiguration`, so the value cannot come from a pipeline override. `DEPLOYMENT.md` ("Setting the flag for a stage") describes the literal, says it has no placeholder, and warns about forward merges. The value is `false` because the Distribution is not deployed; a `true` value has not yet been observed to flow through.
- [ ] Create the three spin-off issues confirmed in PLAN.md Decision 5: PostDeploy `401` check, starter-00 and starter-01 equivalents, and the #13 top-IP widget after this change.
