# Documentation for Operations

This page is the operator's view of origin protection for the API. The full procedures, with commands and cautions, are in [DEPLOYMENT.md, CloudFront ingress and origin protection](../../DEPLOYMENT.md#cloudfront-ingress-and-origin-protection). This page does not repeat them.

## What an operator needs to know

- The API is always a **Regional** API Gateway REST API. The client address in the logs is the address API Gateway recorded, and a caller cannot change it with a header.
- A stage with origin protection on has a generated secret named `Prefix-ProjectId-StageId-OriginSecret`. A stage with it off has no secret.
- Origin protection is **off** until you turn it on for a stage. While it is off, requests are handled as before.
- When it is on, a request that did not come through the stage's CloudFront distribution gets `401`.

## The parameter

| Item | Value |
|------|-------|
| Parameter | `ApiIsBehindCloudFront` |
| Values | `"true"` or `"false"` (default `"false"`) |
| Where it is set | The literal `Parameters.ApiIsBehindCloudFront` in `application-infrastructure/template-configuration.json`, on the branch the stage deploys from |
| Effect when `"true"` | The function can read the origin secret and refuses unverified requests. API Gateway execution data tracing is turned off. |
| Not affected | The API endpoint type. It is Regional in every case. |

Because the file merges forward (`dev`, `test`, `beta`, `main`), a `"true"` merged forward also switches the next stage. Check the value before every forward merge. See [Setting the flag for a stage](../../DEPLOYMENT.md#setting-the-flag-for-a-stage).

## Order of operations for each stage

Go stage by stage: `test`, then `beta`, then `main`.

1. Set the flag to `"true"` and deploy the application stack. This creates the secret and turns enforcement on.
2. Deploy the stage's network stack with `ApiOriginProtection=true` right away. Requests through the distribution get `401` until this finishes.

The `401` responses in the gap have the reason `missing-header`. The secret cannot exist before the flag is `"true"`, so the steps cannot be reordered. Details: [Adopt origin protection, one stage at a time](../../DEPLOYMENT.md#adopt-origin-protection-one-stage-at-a-time).

## Roll back

1. Set the flag to `"false"` and deploy the application stack.
2. Deploy the network stack with `ApiOriginProtection=false`.

The secret is deleted when the flag is `"false"`, and the Regional endpoint stays. See [Roll back](../../DEPLOYMENT.md#roll-back).

## Rotate the secret

1. Store a new value in the secret. The old value becomes `AWSPREVIOUS` and is still accepted.
2. Wait about 65 minutes for warm functions to reload the secret.
3. Change `ApiOriginSecretRevision` on the network stack and deploy it.
4. Wait for the network stack to show `Deployed`.
5. Remove the `AWSPREVIOUS` label.

Commands and reasons: [Rotate the secret](../../DEPLOYMENT.md#rotate-the-secret).

## Log lines

A refused request writes two lines in the function's log group.

| Line | Meaning |
|------|---------|
| `[INGRESS_UNVERIFIED] {"reason":"<code>"}` | Written by `@63klabs/cache-data` when a request is not verified. It holds only the reason code. It never holds an address, a header value, or the secret. |
| `[RESPONSE] 401 ...` | The normal access line for the refusal. |

In PROD, the dashboard widget "Error, Warning, and Unverified Request Log" shows the `INGRESS_UNVERIFIED` lines. The dashboard exists only in PROD. In other stages, filter the function's Lambda log group for `INGRESS_UNVERIFIED`. See [Where unverified requests appear](../../DEPLOYMENT.md#where-unverified-requests-appear).

The caller never sees the reason code. The response body is the same for every reason.

### Reason codes

| Reason | What it means | What to do |
|--------|---------------|------------|
| `missing-header` | The request had no `X-Atlantis-Origin-Secret` header, or it was empty. | A few lines from callers that use the raw `execute-api` URL are expected and are the protection working. Many lines, or lines for requests that went through the distribution, mean the network stack is not sending the header yet. Check that `ApiOriginProtection=true` is deployed for this stage, or set the flag back to `"false"`. |
| `mismatch` | The header was present but equals neither the current nor the previous secret value. | A caller guessing or using an old value is expected. If requests through the distribution show this, the secret and the distribution are out of step. Check the rotation steps and their order. |
| `secret-not-primed` | The function had not finished its first read of the secret when the request arrived. | Normally brief, around a cold start. If it persists, treat it like `secret-unavailable`. |
| `secret-unavailable` | The function could not read the secret. | Check that the flag is `"true"` so the role has the `LambdaAccessToOriginSecret` permission, that the secret exists, and that no permissions boundary blocks `secretsmanager:GetSecretValue`. Every request is refused until this is fixed. |
| `secret-unusable` | The secret's current value is empty, whitespace, or `BLANK`. | Store a generated value in the secret. Every request is refused until this is fixed. |
| `bad-configuration` | `CACHE_DATA_INGRESS_SECRET_NAME` is set but is not a valid secret name or ARN. | The template sets this variable. Look for a manual change to the function's environment and redeploy. |

When every request gets `401`, including requests through the distribution, the first thing to do is set the flag to `"false"` and deploy. This returns the stage to its earlier behavior while you investigate.

## Permissions and access

- The pipeline's CloudFormation service role must be allowed to create, tag, and delete the secret. The network stack's service role must be allowed to read it by name. Any permissions boundary must allow the same actions. See [The secret: lifetime, access, and permissions](../../DEPLOYMENT.md#the-secret-lifetime-access-and-permissions).
- Anyone with `secretsmanager:GetSecretValue` on the secret, or `cloudfront:GetDistributionConfig` on the distribution, can read the secret value.
- The secret is deleted with the stack, or when the flag is set to `"false"`. Secrets Manager keeps it for a recovery window, so recreating a stack with the same name can fail during that window.
- The origin secret shows that a request passed through the distribution. It does not authenticate a caller.

## Checking a stage

- A request through the distribution returns the normal response.
- A request to the raw `execute-api` URL without the header returns `401` with `Cache-Control: no-store`.
- An existing stage that moves from an edge-optimized to a Regional API should be checked first. See [Existing stages: check before the Regional switch](../../DEPLOYMENT.md#existing-stages-check-before-the-regional-switch).
