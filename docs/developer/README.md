# Documentation for Developers

This page covers the ingress guard in the `WebService` function. For how the guard is turned on and off per stage, see [DEPLOYMENT.md, CloudFront ingress and origin protection](../../DEPLOYMENT.md#cloudfront-ingress-and-origin-protection).

All paths below are under `application-infrastructure/src/lambda/web-service/`.

## What the guard does

When origin protection is on for a stage, the guard refuses any request that did not come through the stage's CloudFront distribution. It answers `401` before routing, validation, controllers, or any cache access run.

The guard decides whether to refuse. It does not compare anything itself. `@63klabs/cache-data` compares the `X-Atlantis-Origin-Secret` request header with the origin secret (the current value and the previous value) and reports the result through `ClientRequest.isIngressVerified()`.

## Where it runs

| File | Role |
|------|------|
| `utils/ingress-guard.js` | The guard module. It exports `isIngressGuardOn(env)`, `shouldRefuse(clientRequest, env)`, and `buildRefusal(response)`. |
| `routes/index.js` | `Routes.process(event, context)` creates `ClientRequest` and `Response`, then calls the guard as the first statement in its `try` block. |
| `index.js` | Unchanged. It finalizes whatever `Routes.process` returns, so the refusal is written to the access log with the `RESPONSE` line. |

```javascript
if (IngressGuard.shouldRefuse(REQ)) {
	return IngressGuard.buildRefusal(RESP);
}
```

Keep the guard first. Anything placed before it runs for requests that were never verified.

## How the guard decides

- **Guard on or off.** The guard is on only when the environment variable `CACHE_DATA_INGRESS_SECRET_NAME` holds a non-empty value. The template sets it, to the secret's ARN, only when `ApiIsBehindCloudFront` is `"true"`. When it is not set, `shouldRefuse` returns `false` and never calls the request object. The check must stay conditional: without the variable, `@63klabs/cache-data` reports every request as `direct` and `isIngressVerified()` is `false` for it, so an unconditional guard would refuse all traffic.
- **Fails closed.** With the guard on, a request is served only when `isIngressVerified()` returns exactly `true`. A missing method, a thrown error, or any other value refuses the request.
- **Refusal.** `buildRefusal` sets status `401`, `Cache-Control: no-store`, `Expires: 0`, and the body `{ "message": "Requests must use the service endpoint." }`. It returns the response without finalizing it. The status is `401` and not `403` or `404` because the Atlantis distribution can rewrite `403` and `404` to the landing page with HTTP `200`.
- **Nothing sensitive.** The guard does not log, and does not put the header value, the secret, the secret name, or the reason code in the response. The reason code is only in the `[INGRESS_UNVERIFIED]` line that `@63klabs/cache-data` writes.

## Names you will see

| Name | Where | Purpose |
|------|-------|---------|
| `CACHE_DATA_TRUSTED_PROXY_HOPS` | Function environment, always `"0"` | The client address is API Gateway's `requestContext.identity.sourceIp`. Do not raise it. |
| `CACHE_DATA_INGRESS_SECRET_NAME` | Function environment, only when the flag is `"true"` | The ARN of the origin secret. Turns the guard on. |
| `CACHE_DATA_INGRESS_SECRET_REFRESH_SECONDS` | Not set | The secret is cached for 3600 seconds by default. |
| `ClientRequest.isIngressVerified()` | `@63klabs/cache-data` | `true` only for a verified request. |
| `ClientRequest.getProps().client.ingress` | `@63klabs/cache-data` | `cloudfront`, `direct`, or `unverified`. |
| `ClientRequest.getClientIp()` | `@63klabs/cache-data` | The client address. |

## Do not read forwarding headers yourself

Application code must get the client address and the ingress result only through `@63klabs/cache-data`. Do not read `X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `X-Atlantis-Origin-Secret`, or `requestContext.identity.sourceIp` directly.

- A caller can send most of these headers with any value. With the trusted proxy count at `0`, the library ignores them for the client address.
- The origin header is compared by the library in constant time, and its value is kept out of logs. Reading it in application code would bypass both.

## Changing the refusal

- To change the message or headers, edit `buildRefusal` in `utils/ingress-guard.js`. Keep the status `401`, keep `Cache-Control: no-store`, and keep the reason code and any request value out of the body.
- If you change the `401` response, update the `'401'` entry in `application-infrastructure/template-openapi-spec.yml` to match.
- Do not add a second place that decides whether to refuse. Change `shouldRefuse` instead.

## Local development

The guard is off when `CACHE_DATA_INGRESS_SECRET_NAME` is not set, so local runs and the existing function tests behave as before. To exercise the refusal in your own tests, set the variable to a secret name and make `isIngressVerified` return the value you want on a test double or a stub.

## The API is Regional

`WebApi` is always a Regional REST API. Code that reads a header by an exact-case name should be checked, and `Content-MD5` is passed through to the function. See [Existing stages: check before the Regional switch](../../DEPLOYMENT.md#existing-stages-check-before-the-regional-switch).
