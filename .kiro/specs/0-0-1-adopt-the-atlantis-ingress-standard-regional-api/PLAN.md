# Adopt the Atlantis ingress standard: Regional API behind CloudFront, `CACHE_DATA_TRUSTED_PROXY_HOPS=0`, origin secret

> **Status**: Draft, 5 open questions
> **Issue**: [ISSUE.md](ISSUE.md) (GitHub #14)
> **Reviewed against**: `dev` at `bff7199` on 2026-11-16, plus the uncommitted working-tree changes listed in section 5 (G1)

## 1. Summary

The starter's `WebApi` is edge-optimized (no `EndpointConfiguration`), and its API Gateway endpoint stays reachable by anyone. Behind an Atlantis CloudFront distribution that combination gives every viewer an edge address in the `RESPONSE` log line, and a request that skips the distribution skips its caching and any WAF.

The recommended fix has four parts, all keyed on one new boolean parameter, `ApiIsBehindCloudFront` (default `false`):

1. Set `CACHE_DATA_TRUSTED_PROXY_HOPS` to `0` on the function in every case.
2. Make `WebApi` Regional when the flag is `true`.
3. Create an `OriginSecret` Secrets Manager secret in every stage.
4. When the flag is `true`, give the function `CACHE_DATA_INGRESS_SECRET_NAME`, read access to that one secret, and a guard that answers `401` for a request that did not come through the distribution.

Two details in the issue do not match the code and are corrected in this plan. The environment variable is `CACHE_DATA_INGRESS_SECRET_NAME`, not `CACHE_DATA_ORIGIN_SECRET_NAME`. The guard belongs in `routes/index.js`, not `index.js`, because that is where `ClientRequest` is constructed. Both corrections come from the installed `@63klabs/cache-data` 1.4.1, which already does the header comparison, so the starter adds no comparison code of its own.

A reference implementation of the same standard exists in `63Klabs/atlantis-mcp` v0.0.7 (read through the Atlantis MCP server). This plan follows it where the starter's layout allows.

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| C1 | `WebApi` sets no `EndpointConfiguration`, so it is edge-optimized | Confirmed | `application-infrastructure/template.yml:357-395` (`WebApi` properties contain no `EndpointConfiguration`). SAM's default for `AWS::Serverless::Api` is edge-optimized. |
| C2 | With the default hop count of `2`, every client of the distribution gets the edge address | Partially confirmed | The template sets no `CACHE_DATA_TRUSTED_PROXY_HOPS` (grep finds none). The default in the installed 1.4.1 is `0`, not `2` (`node_modules/@63klabs/cache-data/src/lib/utils/ClientIpResolver.class.js:9`). With `0` on an edge-optimized API behind a distribution, the address is still an edge address, so the symptom holds. The "default 2" figure does not match 1.4.1. It may describe an earlier cache-data release or the issue's own earlier draft. |
| C3 | With `3`, a request that skips the distribution can choose the logged address | Confirmed by the cache-data changelog | cache-data `CHANGELOG.md` v1.4.1: "A count that is too high is not safe: a client that adds `X-Forwarded-For` entries can choose the selected entry". Not reproduced here. |
| C4 | On a Regional API `sourceIp` is the true viewer address through CloudFront or direct, and forged headers do not change it | Unverifiable by reading | Rests on the issue's own measurement (2026-11-09) and the atlantis-mcp admin doc (same date, mock APIs, not this starter). The Atlantis ingress standard (measured 2026-11-08) agrees. **Runtime check**: after the first TEST deploy with the flag `true`, send one request through the distribution and one to the raw URL, each with a forged `X-Forwarded-For`, and compare `requestContext.identity.sourceIp` in the DEBUG event log (`routes/index.js:20`) with the sender. |
| C5 | The `execute-api` endpoint stays publicly reachable | Confirmed | Nothing in the template disables it (no `DisableExecuteApiEndpoint`, no resource policy, no WAF). The Atlantis ingress standard states the distribution cannot disable it. |
| C6 | The secret is named `${Prefix}-${ProjectId}-${StageId}-OriginSecret`, generated, 256-bit | Confirmed as a naming match, adjusted for the value | The name matches the network template's expectation (`api-ingress-standard.md`, "Origin secret") and the AGENTS.md convention. `GenerateSecretString` has no bit-length setting. `PasswordLength: 48` with `ExcludePunctuation: true` gives 62 characters per position, about 285 bits, which meets the 256-bit target. |
| C7 | The handler guard reads `CACHE_DATA_ORIGIN_SECRET_NAME` and sits "after `new ClientRequest(...)`" in `index.js` | **Not confirmed (names and file are wrong)** | cache-data 1.4.1 reads `CACHE_DATA_INGRESS_SECRET_NAME` and header `X-Atlantis-Origin-Secret` (`src/lib/utils/IngressVerifier.class.js`, `ENV_SECRET_NAME`, `SECRET_HEADER`). It exposes `ClientRequest.isIngressVerified()` and `ClientRequest.prime()`. `ClientRequest` is constructed in `routes/index.js:25`, not in `index.js`. |
| C8 | `401` with a JSON body and `Cache-Control: no-store`, never `403` or `404`, because the distribution rewrites those to a landing page | Confirmed (platform behavior) | Atlantis ingress standard, "Distribution-wide 403 and 404 rewrite". Applies only when the network stack has a static origin. Not verifiable from this repo. |
| C9 | The docs (`README.md`, `DEPLOYMENT.md`, `TODO.md`, steering file) do not mention CloudFront | Confirmed | Grep for `cloudfront`, `proxy`, `hops` finds only `AGENTS.md` and `TODO.md:17`, and `TODO.md:17` is about the Cache-Proxy storage stack. |
| C10 | Moving an existing edge-optimized API to Regional is a supported in-place change and the hostname does not change | Confirmed in AWS docs, one caveat | AWS docs ("Change a public or private API endpoint type"): edge-optimized to Regional is supported. The page also says to redeploy the API for the change to take effect and that `Content-MD5` is handled differently. **Runtime check**: after the TEST deploy, run `aws apigateway get-rest-api` (read-only) and confirm `endpointConfiguration.types` is `REGIONAL`, and confirm requests still succeed. |
| C11 | Applications that read header names with an exact case need a check | Confirmed as a risk, low for this starter | Header handling goes through cache-data (`getProps()`); no application file reads `event.headers` directly (grep of `src/lambda/web-service`, excluding `node_modules`). |
| C12 | Dependency: `@63klabs/cache-data` 1.4.1 | Partially confirmed | `package.json` and `package-lock.json` in the working tree say `^1.4.1` / `1.4.1`, but both changes are uncommitted. `HEAD` still locks `1.3.17` (see G1). |
| C13 | The secret costs about $0.40 per stage per month | Confirmed for storage | AWS Secrets Manager pricing page, worked example: `$0.40` per secret per month. The per-API-call price was not retrieved. With the extension cache and a one-hour refresh, call volume is small. |

## 3. Current state

- **API**: `WebApi` is an `AWS::Serverless::Api` with a `DefinitionBody` include of `template-openapi-spec.yml`, CORS, optional access and execution logging (`template.yml:357-395`). The stage name is `ApiPathBase`. There is no endpoint type, no custom domain, no WAF, no resource policy. The custom domain and the CloudFront distribution belong to the separate network stack (AGENTS.md section 2.1 and 3.1).
- **Function**: a single function, `WebService` (`template.yml:421`), with its own execution role `WebServiceLambdaExecutionRole`. Environment variables are set per function and not in `Globals` (only `Api` and `Function` tracing and tag propagation are in `Globals`). `LOG_LEVEL` is `DEBUG` in every non-PROD environment (`template.yml:475`).
- **Secrets Manager access today**: the Parameters and Secrets Lambda Extension layer is already attached (`template.yml:450-468`, resolved from the public SSM parameter). cache-data reads secrets through the extension when present and through the SDK otherwise. The role has SSM read access under `${ParameterStoreHierarchy}*` and nothing for Secrets Manager (`template.yml:548-566`).
- **Request flow**: `index.js` runs `Config.init()` at cold start, awaits `Config.promise()` and `Config.prime()` (`index.js:58-59`), then calls `Routes.process(event, context)`. `Routes.process` builds `ClientRequest` and `Response` (`routes/index.js:25-26`), checks `REQ.isValid()`, routes `GET` only, and returns `RESP`. `Config.prime()` already calls `CachedParameterSecrets.prime()` (`config/index.js:122-127`). In cache-data 1.4.1 that primes the ingress secret readers, which register when `ClientRequest` loads (`ClientRequest.class.js:7-11`). No extra `ClientRequest.prime()` call is needed.
- **Logging**: `routes/index.js:20` logs the whole event at DEBUG. cache-data's `DebugAndLog` sanitizes values under keys containing `key`, `secret`, or `token` (`utils.js`, `sanitize`). The header name `x-atlantis-origin-secret` contains `secret`, so it is masked in Lambda logs. The mask keeps the last four characters (per the comment in `sanitize`).
- **Why it is this way**: the starter was written before the ingress standard. `git log` for `template.yml` shows no earlier decision about endpoint type or client address. There is nothing to regress.
- **Reference implementation**: `63Klabs/atlantis-mcp` v0.0.7 uses an always-Regional `WebApi`, `CACHE_DATA_TRUSTED_PROXY_HOPS: '0'` per function, `CACHE_DATA_INGRESS_SECRET_NAME` set to the secret ARN under the flag, an `ingress-guard.js` helper, and a template test. Its refusal body is `{"message":"Requests must use the service endpoint."}`.

## 4. Review

### 4.1 Security

- **Trust boundary**: `X-Forwarded-For` and any other forwarding header are caller-controlled on the raw `execute-api` URL. The fix removes the dependency on them: count `0` makes cache-data use `sourceIp` only, and a Regional API makes `sourceIp` the viewer. A test must forbid a non-zero count.
- **What the secret proves**: the origin secret proves a request passed through a distribution configured with that secret. It does not authenticate the caller. Existing authorization stays. Anyone with `secretsmanager:GetSecretValue` on the secret or `cloudfront:GetDistributionConfig` on the distribution can read it (ingress standard, "Who can read the secret"). The docs must say so.
- **Fail closed**: with the flag `true`, a missing, unreadable, blank, or unprimed secret makes `isIngressVerified()` return `false`, so the request gets `401`. The guard must also treat a missing method or a thrown error as unverified. With the flag `false` the variable is unset, cache-data reports `direct`, and `isIngressVerified()` is `false` for `direct`, so the guard must be skipped when the variable is unset. An unconditional guard would refuse all traffic.
- **Secret in logs**: the header is masked by `DebugAndLog` in Lambda logs, with the last four characters kept. API Gateway execution logging is a separate path. In non-PROD, `DataTraceEnabled` is `True` whenever `ApiGatewayLoggingEnabled` is `TRUE` (`template.yml:392`), and full request-data tracing writes method request headers to `API-Gateway-Execution-Logs_*`. That would write the unmasked secret to CloudWatch in TEST. Verification needed (see Q2). The standard says "Never log the header or the secret, including ... request dumps."
- **Response shape**: `Response.reset()` replaces headers with the generic ones for the status code, and `finalize()` adds `Expires` and `Cache-Control: max-age=<errorExpirationInSeconds>` to any 4xx response unless already set (`Response.class.js:742-755`). The guard must set `Cache-Control: no-store` and `Expires: 0` after `reset()`, otherwise a `401` is marked cacheable for 300 seconds (`config/responses.js`, `errorExpirationInSeconds`).
- **No oracle**: the `401` body is fixed text. It must not echo the header, the secret name, or the reason code. cache-data already writes one `INGRESS_UNVERIFIED` log line with a reason code and no value.
- **IAM**: one statement, `secretsmanager:GetSecretValue` on `!Ref OriginSecret` (the ARN, which includes the random suffix), created only when the flag is `true`. No `*` resources, no managed policy. If an org permissions boundary is used, it must allow that action. A customer-managed KMS key would also need `kms:Decrypt`; the default `aws/secretsmanager` key does not.
- **Disclosure**: the issue is already public on GitHub and describes a design gap (client address and open entry point), not a new exploit. Keep PLAN and the later spec at the level of detail the decisions need. No special embargo handling is proposed.

### 4.2 Software engineering

- **Where the guard goes**: `routes/index.js`, right after `new ClientRequest` and `new Response`, before `isValid()`, routing, and any controller or cache access. A small `utils/ingress-guard.js` (functions `isIngressGuardOn(env)`, `shouldRefuse(req, env)`, `buildRefusal(resp)`) keeps the handler thin and gives the unit tests a seam. The reference implementation does the same. `utils/` is already used for shared helpers (`utils/hash.js`, `utils/helper-functions.js`).
- **Handler drift**: the steering file's "Handler Pattern" shows `ClientRequest` created in `index.js` and `Routes.process(clientRequest, response)`, while the real code creates both inside `Routes.process(event, context)`. The steering text must be corrected where this change touches it, or the guard instructions will point at the wrong file.
- **Tests that change or are missing**: `tests/index.test.js` covers validations, utils, and one view. It has no handler or route test, and it calls `process.exit(0)` when Node is below 22. New tests: guard unit tests using the real `ClientRequest` and `Response` (verified, unverified, flag off, throws, missing method; `401` shape including `Cache-Control`, `Expires`, content type, no secret in the body); a `Routes.process` test that an unverified request reaches no controller; a template test (below). Mocking: `aws-sdk-client-mock` is already a dev dependency, but the guard tests should stub `isIngressVerified` or set the environment variable and inject the secret through cache-data's test seam rather than call AWS.
- **Template test**: it must fail when the endpoint type and the count disagree, when the variable appears under `Globals`, when `CACHE_DATA_INGRESS_SECRET_NAME` is set without the condition, when the permission is not scoped to the one secret, and when the secret has an output or export. Parsing `template.yml` needs CloudFormation tags (`!Ref`, `!If`, `!Sub`, `!GetAtt`, `!FindInMap`). See Q4.
- **Dependencies**: no new production dependency. A YAML parser would be a dev dependency only (AGENTS.md 5.2). The build runs `npm audit --omit=dev`, so a dev dependency does not affect the audit gate. The CodeBuild `rm -rf tests` step runs after tests, so the template test can read `../../../template.yml` from the function directory during the build (the pipeline's source tree is intact at that point). Verify this on the first TEST pipeline run.
- **Backward compatibility**: with the flag `false` the only observable changes are the new secret, an explicit `CACHE_DATA_TRUSTED_PROXY_HOPS=0` (same as the 1.4.1 default), and the dependency bump. The `RESPONSE` line still logs `sourceIp`-derived addresses. Existing adopters copy the starter; nothing migrates automatically.
- **OpenAPI**: add a `401` entry to `DataResponses` in `template-openapi-spec.yml`. The `responses:` block is shared by both paths and only documents behavior (the integration is `aws_proxy`). Keep the existing `403` entry.

### 4.3 Cloud engineering

- **Topology**: viewer, CloudFront (network stack, outside this repo), API Gateway, Lambda. On an edge-optimized API an AWS-managed CloudFront distribution sits between the application's distribution and the API, which hides the viewer address. A Regional API removes that hop.
- **Template changes** (all in `application-infrastructure/template.yml`): parameter `ApiIsBehindCloudFront` (`"true"`/`"false"` strings or a boolean-style `AllowedValues`, matching the existing `ApiGatewayLoggingEnabled` style), a condition, `WebApi.EndpointConfiguration`, `OriginSecret`, one environment variable pair, one conditional IAM statement, and a `Metadata` group entry. Per AGENTS.md the template stays within this application's stack.
- **Edge to Regional is an in-place update** and the `execute-api` hostname does not change. CloudFormation updates the `RestApi`; the endpoint type cannot be changed again until the first change finishes. Flipping the flag back reverses it.
- **Order of operations per stage** (from the issue and the Atlantis docs):
  1. Deploy the application stack with the flag `false`. This creates the secret.
  2. Deploy the stage's network stack with `ApiOriginProtection=true`. The distribution starts sending the header. The application ignores it.
  3. Set the flag `true` and deploy the application stack.
  Never swap steps 2 and 3. With the flag `true` and a distribution that does not send the header, every request is refused, including the distribution's. Rollback reverses steps 3 and 2. The secret stays.
- **Prerequisites owned elsewhere**: the pipeline's CloudFormation service role must be allowed to create the secret (Atlantis docs: it can manage `Prefix-ProjectId-StageId-*` secrets, and the pipeline stack may need an update). The network service role must be able to read it. Neither is changed from this repo (AGENTS.md 2.1). Org permission boundaries may also need `secretsmanager:GetSecretValue` for the function role.
- **Per-stage flag value**: `template-configuration.json` is one file for all branches, so the flag cannot live there without every merge changing it. The per-stage value should come from the stage's `parameter_overrides` in the organization's SAM config repo (the Atlantis `SamconfigReader` merges default and stage overrides). The repository's `template-configuration.json` stays without the parameter and uses the template default. This is read from the Atlantis config-scripts source and should be confirmed against the SAM config docs while writing `DEPLOYMENT.md`.
- **Gradual deployment**: in PROD the API type changes with the stack update while the Lambda alias shifts over minutes. Traffic that reaches the old function version is not guarded; traffic that reaches the new version is. Both versions get the distribution's header, so there is no outage. A short period of mixed behavior is expected and should be noted in the docs.
- **Stages**: TEST and DEV log at DEBUG; PROD logs at INFO. The guard behaves the same in every stage. The secret exists in every stage so the network stack can reference it before enforcement starts. DEV created by local `sam deploy` also gets one (about $0.40 per month).
- **Deletion**: the secret is deleted with the stack, and Secrets Manager keeps it for a recovery window (30 days by default). Recreating a stack with the same name inside that window can fail on the secret name. Document it. CloudFormation cannot set the recovery window.
- **Observability**: the Atlantis standard says to count rejections. cache-data writes `[INGRESS_UNVERIFIED] {"reason":"..."}` on every unverified request. A `AWS::Logs::MetricFilter` on `WebServiceLogGroup` can count them (reference: namespace `<Prefix>-<ProjectId>/Ingress`, metric `UnverifiedRequestCount`, no alarm). See Q3.
- **CORS preflight**: `Cors` on `WebApi` makes SAM generate `OPTIONS` methods answered by API Gateway itself, so the Lambda guard does not see them. The reference implementation documents the same. **Runtime check**: after the TEST deploy, send `OPTIONS` to the raw URL and confirm the response carries no data.
- **Rollout and rollback**: handled by the order above and by the pipeline's existing gradual deployment and alarms in PROD. There is no new alarm unless Q3 chooses one.

## 5. Gaps and observations

| # | Item |
|---|------|
| G1 | **Uncommitted changes on `dev`.** `git status` shows modified `template.yml` (public SSM resolve for the Parameters and Secrets layer; removal of `CACHE_DATA_USE_TOOLS_HASH_METHOD`), `package.json` (`^1.4.1`), and `package-lock.json` (`1.4.1`). This change needs 1.4.1 (`isIngressVerified()` does not exist in 1.3.x, so the guard would throw). Commit or stash the dependency bump first. The other `template.yml` edits are unrelated and must not be folded into this change by accident. |
| G2 | The issue's env var name and guard file are wrong (C7). `ISSUE.md` is not edited by this skill. Requirements will use the corrected names. |
| G3 | The "default 2" in the issue does not match 1.4.1 (C2). Setting `0` explicitly is still right: it documents intent, survives a future default change, and is what the template test pins. |
| G4 | No `docs/` content exists (each README says `TODO`). AGENTS.md section 9 asks for `ARCHITECTURE.md`, `DEPLOYMENT.md`, `CHANGELOG.md`, `docs/admin-ops`, `docs/developer`, and `docs/end-user` updates after major changes. `CHANGELOG.md` has only `v0.0.1 (unreleased)` with `TODO`. |
| G5 | `ARCHITECTURE.md` shows `Client -> API Gateway -> Lambda` only. It needs the CloudFront and secret path and a note under "Key Design Decisions". |
| G6 | The issue says the first-deploy `TODO.md` does not mention CloudFront. The checklist is short, so the addition is one prerequisite line and one post-deploy line. |
| G7 | The steering file `atlantis-webapi-node-cache-data.md` documents a handler shape that differs from the code (see 4.2). It also lists env vars `CACHE_TABLE` and `CACHE_BUCKET`, while the template uses `CACHE_DATA_DYNAMO_DB_TABLE` and `CACHE_DATA_S3_BUCKET`. Only the parts this change touches are in scope. |
| G8 | The template header says `Version: v2.0.6/2026-03-26`. Whether this change bumps it is a maintainer convention not stated anywhere in the repo. Assume yes, and update the date and patch number when the spec is implemented. |
| G9 | The issue's "Open points" are resolved by this plan as follows: endpoint type for every deployment (Q1), Python starters (out of scope, spin-off S2), a stage without CloudFront keeps the flag `false` (design), cost (C13). |
| G10 | cache-data 1.4.1 treats a stored value of `BLANK` as unusable. `GenerateSecretString` never produces it, but the docs should warn against hand-editing the secret to a placeholder. |

## 6. Proposed approach

Everything here fits the existing template and MVC layout. Parts marked "pending Q#" depend on an open question.

**Template (`application-infrastructure/template.yml`)**
- Parameter `ApiIsBehindCloudFront`: `String`, default `"false"`, `AllowedValues: ["true", "false"]`, listed in the `Application Parameters` metadata group. Condition `ApiIsBehindCloudFrontIsTrue`.
- `WebApi.EndpointConfiguration`: `Type: REGIONAL` when the condition holds, `!Ref AWS::NoValue` otherwise (pending Q1).
- `OriginSecret`: `AWS::SecretsManager::Secret`, no condition, name `${Prefix}-${ProjectId}-${StageId}-OriginSecret`, `GenerateSecretString` with `PasswordLength: 48` and `ExcludePunctuation: true` (plain string, not JSON), description only, no output, no export, no parameter. Tags come from the stack.
- `WebService` environment: `CACHE_DATA_TRUSTED_PROXY_HOPS: "0"` always, in the function's own `Environment.Variables` and not in `Globals`. `CACHE_DATA_INGRESS_SECRET_NAME: !Ref OriginSecret` (the ARN) only under the condition. `CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS` stays unset (default 3600).
- `WebServiceLambdaExecutionRole`: one extra statement, `Sid: LambdaAccessToOriginSecret`, `secretsmanager:GetSecretValue` on `!Ref OriginSecret`, only under the condition.
- `DataTraceEnabled` handling (pending Q2). `MetricFilter` on `WebServiceLogGroup` under the condition (pending Q3).

**OpenAPI (`template-openapi-spec.yml`)**: add `'401'` to `DataResponses` with a JSON schema for `{ message }`.

**Code (`application-infrastructure/src/lambda/web-service`)**
- `utils/ingress-guard.js` with `isIngressGuardOn(env)`, `shouldRefuse(clientRequest, env)`, and `buildRefusal(response)`. Guard on only when `CACHE_DATA_INGRESS_SECRET_NAME` is a non-empty string after trimming. `shouldRefuse` returns `true` unless `clientRequest.isIngressVerified() === true`, and treats a missing method or a throw as unverified. `buildRefusal` calls `reset({statusCode: 401})`, then sets `Cache-Control: no-store` and `Expires: 0`, sets the body to `{ message: 'Requests must use the service endpoint.' }`, and returns the response. The message is the one used by the reference implementation so Atlantis apps answer alike.
- `routes/index.js`: after `new ClientRequest` and `new Response`, call the guard first. A refused request skips `isValid()`, routing, controllers, and cache access, and is still returned through the normal `finalize()` path in `index.js` so the `RESPONSE` log line is written. No code reads `X-Forwarded-For`, `CloudFront-Viewer-Address`, `x-atlantis-origin-secret`, or `identity.sourceIp`; a source-scan test enforces this.
- Dependency: `@63klabs/cache-data` `^1.4.1`, locked at 1.4.1 or later.

**Tests (`tests/`)**: guard unit tests, a routes test for the unverified path, a source-scan test for forbidden header reads, and a template test (technique pending Q4) that checks: endpoint type and count agree; the count variable is not in `Globals`; the ingress variable and the IAM statement exist only under the condition; the permission names the one secret; the secret has no output, export, or JSON key; `DataTraceEnabled` follows Q2.

**Docs**: `README.md` (feature line), `ARCHITECTURE.md` (diagram and design decision), `DEPLOYMENT.md` (adoption order, rollback, rotation, deletion window, stage values from the SAM config repo, who can read the secret), `TODO.md` (prerequisite and post-deploy check), `CHANGELOG.md`, `docs/admin-ops` and `docs/developer` (the `TODO` placeholders become short pages covering the operator view and the guard), `docs/end-user` (the `401` response, one paragraph), and the steering file (CloudFront section, corrected handler pattern, the new environment variables).

**Alternatives considered**
- *A handler-side comparison with `crypto.timingSafeEqual` and a starter-owned secret reader*: rejected. cache-data 1.4.1 already does the comparison, rotation (`AWSCURRENT` and `AWSPREVIOUS`), caching, and logging. Duplicating it adds code to maintain.
- *An API Gateway Lambda authorizer*: language-neutral, rejects before the function runs, adds a function, latency, and cost. The issue records it as the answer for non-Node starters, not for this change.
- *An AWS WAF web ACL on the stage*: rejects earlier but adds per-request charges and stores the secret in the ACL. Optional per the Atlantis standard; not proposed.
- *Hop count `3` on an edge-optimized API*: gives the viewer address but is forgeable on the raw URL. Rejected by the issue and by cache-data's own guidance.
- *Disabling the `execute-api` endpoint*: not possible while the distribution uses it as its origin.

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| Correct the steering file's handler pattern and env var names where this change edits it | Include | The guard instructions would otherwise point at the wrong file | S | Low |
| Count unverified requests with a metric filter (no alarm) | Include, pending Q3 | The Atlantis standard requires counting rejections | S | Low |
| Keep API Gateway execution `DataTrace` off when the flag is `true` | Include, pending Q2 | Prevents the secret from reaching CloudWatch in TEST | S | Low |
| PostDeploy check that a raw-URL request without the secret gets `401` | Spin off (S1) | The starter has no PostDeploy buildspec; the reference implementation has one. Valuable but a separate pipeline change | M | Low |
| Same change for starter-00 and starter-01 (Python) | Spin off (S2) | Different repositories and runtimes; the issue says this is not part of the change | M each | Low |
| Dashboard widget for top client IPs (#13) | Spin off (S3, already issue #13) | Depends on this change landing so the IP is the real client | S | Low |
| Optional PROD alarm on unverified requests | Note only | Adds an alarm and an SNS topic to maintain; reference has none | S | Low |
| WAF web ACL on the stage | Note only | Earlier rejection, extra cost, second copy of the secret | L | Medium |
| `CloudFront` rewrites app `403`/`404` to a landing page when a static origin exists. The router already returns `404` for unknown routes (`routes/index.js:60`) | Note only | Existing behavior, worth a sentence in the docs | S | Low |
| `template.yml` and `package.json` working-tree edits (SSM resolve, removed hash variable) | Note only | Unrelated to this issue; commit separately (G1) | S | Low |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Flag set to `true` before the distribution sends the header, so every request gets `401` | Document the order. The guard is off unless the flag is `true`. Rollback is flipping the flag. The `INGRESS_UNVERIFIED` log line shows `missing-header` for every request in this case. |
| Switching the API type during PROD gradual deployment gives mixed behavior for a few minutes | Document it. Both function versions accept requests that carry the header. |
| Secret exposed in API Gateway execution logs (TEST, when `ApiGatewayLoggingEnabled` is `TRUE`) | Q2. Verify on TEST by reading the execution log group. |
| Last four characters of the secret appear in masked DEBUG logs | Accept. The value is 48 characters. Document that DEBUG logs are not a secret store. |
| Secret name collision when a stack is deleted and recreated inside the recovery window | Document. Choose a different `StageId` for throwaway stacks or wait for the window to end. |
| Pipeline service role cannot create the secret (`AccessDenied`) | Prerequisite in `DEPLOYMENT.md` and `TODO.md`. The fix is in the pipeline stack, outside this repo. |
| Org permissions boundary blocks `secretsmanager:GetSecretValue` | Prerequisite line in the docs. The guard then fails closed and every request gets `401`. |
| Someone adds a non-zero hop count or reads `X-Forwarded-For` later | Template test and source-scan test fail the build. |
| cache-data below 1.4.1 gets installed (for example a lock file regenerated from an older range) | `package.json` range `^1.4.1`; the guard treats a missing `isIngressVerified` as unverified, which fails closed rather than open. |
| Rotation made without waiting for warm functions to reload | Document the wait (3600 seconds refresh plus extension cache) from the reference admin doc. A mismatch reloads at most once a minute per container. |
| An `OPTIONS` preflight to the raw URL is answered without the guard | Expected. It carries no data. Verify on TEST (4.3). |

## 9. Locked decisions

None yet.

## 10. Open questions and recommendations

### Q1. Regional only under the flag, or always?
**Why it matters:** The issue's own first open point. It decides the template condition, the template test, and what existing adopters see after copying the change.
**Options:**
- **A. Regional only when `ApiIsBehindCloudFront` is `true`.** A stage without CloudFront keeps its current edge-optimized API, so nothing changes for it. The count is `0` either way, which is correct for a directly reachable API of either type. Cost: a team that puts its own CloudFront in front but leaves the flag `false` keeps an edge-optimized API and logs the edge address. The docs must say "set the flag when a distribution is in front".
- **B. Always Regional.** This matches the Atlantis standard and the reference implementation, removes the wrong combination (edge-optimized behind CloudFront with count `0`), and makes the flag only about enforcement. Cost: every adopter loses the AWS-managed edge acceleration for directly reachable APIs and takes the Regional behavior changes (for example `Content-MD5`) without having asked.
- **C. Other**: describe.
**Recommendation:** A. The starter is a template that many people copy for different topologies, and the flag name already says when Regional applies. A also keeps the template test one sentence: endpoint type follows the flag, count is `0`.
**Answer:** B - this matches the Atlantis standard

### Q2. API Gateway execution `DataTrace` when the flag is `true`
**Why it matters:** `DataTraceEnabled` is `True` in non-PROD when `ApiGatewayLoggingEnabled` is `TRUE` (`template.yml:392`). Full request tracing writes request headers to the execution log group, so the origin secret would be written unmasked to CloudWatch in TEST. I could not confirm the header appears there without a deploy.
**Options:**
- **A. Turn `DataTraceEnabled` off whenever the flag is `true`**, keep `MetricsEnabled` and the log level as they are. Costs one nested `!If` and loses request-body tracing in TEST for flagged stages.
- **B. Leave the template as is and document the exposure.** No template change; relies on operators reading the warning.
- **C. Other**: describe.
**Recommendation:** A, because the secret is an ingress token that the standard says must never be logged, and the loss is only a debugging aid in TEST.
**Answer:** A

### Q3. Count unverified requests
**Why it matters:** The Atlantis standard requires counting rejections so probing or a misconfigured rollout is visible. The issue does not include it.
**Options:**
- **A. Include a metric filter only.** `AWS::Logs::MetricFilter` on `WebServiceLogGroup`, under the flag condition, matching `INGRESS_UNVERIFIED`, namespace `${Prefix}-${ProjectId}/Ingress`, metric `UnverifiedRequestCount`, no alarm. This is what the reference implementation does. A custom metric is billed per month (check the CloudWatch price).
- **B. Metric filter plus a PROD alarm and use of the existing SNS topic.** Earlier notice, but a few unverified requests are expected during switch-over, so the alarm needs a threshold decision.
- **C. Spin off** to its own issue and ship the guard without a metric.
- **D. Other**: describe.
**Recommendation:** A. It meets the standard with one small resource and avoids choosing an alarm threshold before there is data.
**Answer:** D - this starter solution should incur minimal cost, and fixing the unverified requests should be a one time fix. Either the ERROR logs in the prod dashboard need to display it or there needs to be a custom widget on the dashboard. (I opt to making sure the ERROR logs widget displays it.) Check the cache-data package logging and if it is listed as a WARN or ERROR then it should show up. I can verify after deployment.

### Q4. How the template test reads `template.yml`
**Why it matters:** The template uses CloudFormation tags, so a plain YAML load fails. The choice sets the dev dependency list and how brittle the test is.
**Options:**
- **A. Add `js-yaml` as a dev dependency** with a small schema that accepts the CloudFormation tags (`!Ref`, `!Sub`, `!If`, `!GetAtt`, `!FindInMap`, `!Equals`, `!Not`, `!And`) and parse the template into an object. Precise assertions; one dev dependency, excluded from the production audit and the Lambda package.
- **B. No new dependency; scan the template text** with line- and indentation-aware matching. Nothing to install, but assertions such as "the variable is under `WebService.Environment` and not `Globals`" are brittle.
- **C. Other**: describe.
**Recommendation:** A. AGENTS.md 5.2 targets production dependencies, and the reference implementation also tests the template structurally. Brittle text matching on the one file that controls the security posture is the worse trade.
**Answer:** A

### Q5. Spin-off dispositions
**Why it matters:** The skill needs a confirmed decision for each separable item before the plan locks. None is created by this plan.
**Options:**
- **A. Create all three as separate issues:** S1 PostDeploy verification of the `401`, S2 the same standard for starter-00 and starter-01, S3 dashboard widget (#13 already exists, so this only confirms the ordering "after this change").
- **B. Fold S1 into this change.** Adds a PostDeploy buildspec and a pipeline-role requirement that the starter does not have today.
- **C. Drop one or more** (name them).
- **D. Other**: describe.
**Recommendation:** A. S1 needs pipeline changes that live partly outside this repo, S2 is in other repositories, and #13 already exists.
**Answer:** A
