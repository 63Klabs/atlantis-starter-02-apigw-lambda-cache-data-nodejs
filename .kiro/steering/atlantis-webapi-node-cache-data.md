---
inclusion: fileMatch
fileMatchPattern: '**/*.{js,mjs,cjs,ts,tsx,jsx}'
---

# Atlantis WebApi using Node.js and @63klabs/cache-data

This project uses the Atlantis Starter Application #02 pattern. All Lambda functions triggered by API Gateway MUST use the `@63klabs/cache-data` npm package and follow the MVC architecture described here.

The assumption is that applications start small and grow complex. The right framework, patterns, and directory organization must be used from the start to support that growth.

## Required Infrastructure

Every API Gateway-triggered Lambda in this project MUST:

- Maintain an updated OpenAPI spec in `template-openapi-spec.yml`
- Enable AWS X-Ray tracing (cache-data instruments subsegments automatically)
- Enable Lambda Insights for enhanced monitoring
- Use `@63klabs/cache-data` for routing, validation, logging, response generation, configuration, and AWS SDK access
- Include the Lambda SSM Parameters and Secrets Extension Layer for use by Cache-Data

### CloudFront topology

The API Gateway REST API (`WebApi`) is always Regional. An edge-optimized API is not supported by this starter. A stage may sit behind a CloudFront distribution that is deployed by the network stack, not by this application stack. The distribution adds the `X-Atlantis-Origin-Secret` header to every request it forwards.

- `ApiIsBehindCloudFront` (`"true"` or `"false"`, default `"false"`) turns origin enforcement on for a stage. Set it as the literal value in `application-infrastructure/template-configuration.json` on the branch being deployed.
- The `OriginSecret` secret exists in every stage. Only when the flag is `"true"` does the function receive the secret's ARN in `CACHE_DATA_INGRESS_SECRET_NAME` and permission to read that one secret.
- `@63klabs/cache-data` compares the header with the secret. The function code never reads `X-Forwarded-For`, `Forwarded`, `X-Real-Ip`, `CloudFront-Viewer-Address`, `X-Atlantis-Origin-Secret`, or `requestContext.identity.sourceIp`. Get the client address and the ingress result only from `ClientRequest`.
- A request that is not verified receives `401` with `Cache-Control: no-store`. Use `401`, not `403` or `404`, because the distribution can rewrite those two to a landing page.

## Package Overview

The `@63klabs/cache-data` package provides three main modules:

```javascript
const {
  cache: { Cache, CacheableDataAccess },
  endpoint,
  tools: {
    AppConfig, ClientRequest, Response, DebugAndLog, Timer,
    Connection, Connections, ConnectionAuthentication,
    ApiRequest, CachedParameterSecrets, CachedSsmParameter,
    ImmutableObject
  }
} = require('@63klabs/cache-data');
```

- **cache**: `Cache` for storage initialization, `CacheableDataAccess` for cached data retrieval backed by DynamoDB and S3
- **endpoint**: `endpoint.send()` for simple HTTP requests with X-Ray tracing
- **tools**: Request/response handling, configuration, logging, connections, and AWS SDK wrappers with built-in X-Ray support

## MVC Architecture

Cache-data follows a Model-View-Controller pattern. The request lifecycle is:

```
API Gateway Event
  → index.js (Handler)
    → Config.init() / Config.promise() / Config.prime()
    → Routes.process(event, context)
      → new ClientRequest(event, context) // parse + validate
      → new Response(clientRequest)
      → Controller.method(props)
        → Service (business logic)
          → Model/DAO (data access, caching)
        ← data
      ← populated response
    → response.finalize()                 // CORS, logging, headers
  ← API Gateway Response
```

## Directory Structure

Each Lambda function that serves API Gateway requests follows this layout:

```
src/lambda/{function-name}/
├── index.js              # Handler entry point
├── package.json
├── config/
│   ├── index.js          # Config class extending AppConfig
│   ├── settings.js       # Application settings (env vars, feature flags)
│   ├── connections.js    # Connection and cache profile definitions
│   ├── validations.js    # ClientRequest parameter validation rules
│   └── responses.js      # Response format settings (TTLs, templates)
├── routes/
│   └── index.js          # Request routing logic
├── controllers/          # Business logic orchestration
│   └── {resource}.js
├── services/             # Service layer (API calls, processing)
│   └── {resource}.js
├── models/               # Data Access Objects (DAOs), fetch methods
│   └── {resource}.js
├── views/                # Response formatting/transformation
│   └── {format}.js
├── utils/                # Shared utilities
│   └── {utility}.js
└── tests/
    ├── unit/
    └── property/
```

## Handler Pattern (index.js)

The handler is the Lambda entry point. Keep it thin. It initializes config on cold start and delegates to `Routes.process(event, context)`. `Routes.process` creates the `ClientRequest` and `Response`, runs the ingress guard, routes the request, and returns the `Response`. The handler then finalizes it.

```javascript
const { tools: { DebugAndLog, Response, Timer } } = require("@63klabs/cache-data");
const { Config } = require("./config");
const Routes = require("./routes");

// Cold start: init outside handler, runs once per container
const coldStartInitTimer = new Timer("coldStartTimer", true);
Config.init();

exports.handler = async (event, context) => {
  let response = null;

  try {
    // Wait for cold start initialization to complete
    await Config.promise();
    await Config.prime();
    if (coldStartInitTimer.isRunning()) {
      DebugAndLog.log(coldStartInitTimer.stop(), "COLDSTART");
    }

    // Routes.process creates ClientRequest and Response, and returns the Response
    response = await Routes.process(event, context);

  } catch (error) {
    DebugAndLog.error(`Unhandled Execution Error in Handler  Error: ${error.message}`, error.stack);

    // Failed before the request was parsed, so there is no ClientRequest to link
    // >! Return a sanitized error to the client, no internal details
    response = new Response({ statusCode: 500 });
    response.setBody({ message: "Error initializing request" });

  } finally {
    // Finalize: sets CORS, cache-control, execution time, logs response
    return response.finalize();
  }
};
```

Key rules:
- `Config.init()` is called outside the handler so it only runs on cold start
- `await Config.promise()` and `await Config.prime()` are called inside the handler to ensure initialization completed
- `Timer` tracks cold start duration and only logs once
- `ClientRequest` and `Response` are created in `Routes.process(event, context)`, not in the handler
- `response.finalize()` MUST be called exactly once to produce the API Gateway response with proper CORS, cache-control, and logging

## Configuration (config/index.js)

Extend `AppConfig` from cache-data. Pass settings, validations, connections, and responses to `AppConfig.init()`. Initialize `Cache` with a secure data key from SSM Parameter Store.

```javascript
const {
  cache: { Cache, CacheableDataAccess },
  tools: { DebugAndLog, Timer, CachedParameterSecrets, CachedSsmParameter, AppConfig }
} = require("@63klabs/cache-data");

const settings = require("./settings.js");
const validations = require("./validations.js");
const connections = require("./connections.js");
const responses = require("./responses.js");

class Config extends AppConfig {

  static init() {
    const timerConfigInit = new Timer("timerConfigInit", true);
    try {
      AppConfig.init({ settings, validations, connections, responses, debug: true });

      Cache.init({
        // >! Retrieve secure data key from SSM, never hardcode
        secureDataKey: new CachedSsmParameter(
          process.env.PARAM_STORE_PATH + 'CacheData_SecureDataKey',
          { refreshAfter: 43200 } // 12 hours
        ),
      });
    } catch (error) {
      DebugAndLog.error(`Could not initialize Config ${error.message}`, error.stack);
    } finally {
      timerConfigInit.stop();
    }
    return AppConfig.promise();
  }

  static async prime() {
    return Promise.all([
      CacheableDataAccess.prime(),
      CachedParameterSecrets.prime()
    ]);
  }
}

module.exports = { Config };
```

After initialization, use:
- `Config.settings()` to access application settings
- `Config.getConnCacheProfile('connection-name', 'profile-name')` to get cache profiles for connections

## Validation (config/validations.js)

Define parameter validation functions and export them for `ClientRequest.init()`. The OpenAPI spec in `template-openapi-spec.yml` is the primary validation layer. Lambda-side validation is secondary. The validations contained within validations.js are done at the request receive level and can be used to fail the request quickly. More complex validation may occur at the controller level.

```javascript
const ALLOWED_REFERRERS = ['*']; // or specific domains for CORS
const EXCLUDE_PARAMS_WITH_NO_VALIDATION_MATCH = false;

const isStringOfNumbers = (value) => /^\d+$/.test(value);

module.exports = {
  referrers: ALLOWED_REFERRERS,
  parameters: {
    excludeParamsWithNoValidationMatch: EXCLUDE_PARAMS_WITH_NO_VALIDATION_MATCH,
    pathParameters: {
      id: isStringOfNumbers,
    },
    queryStringParameters: {
      // paramName: validatorFunction,
      // BY_ROUTE: [{ route: "GET:api/resource", validate: customValidator }]
    },
    // headerParameters: {},
    // cookieParameters: {},
    // bodyParameters: {},
  }
};
```

Validation priority order (highest to lowest):
1. Method-and-route match (`BY_ROUTE` with `"METHOD:route"`)
2. Route-only match (`BY_ROUTE` with `"route"`)
3. Method-only match (`BY_METHOD` with `"METHOD"`)
4. Global parameter name

## Connections (config/connections.js)

Define connection profiles for external data sources and their cache profiles. Each connection has a name, host, path, and an array of cache profiles with TTL settings.

```javascript
const { tools: { DebugAndLog } } = require("@63klabs/cache-data");
const IS_PRODUCTION = DebugAndLog.isProduction();

const connections = [
  {
    name: 'my-api',
    host: 'api.example.com',
    path: '/v1',
    cache: [
      {
        profile: 'default',
        overrideOriginHeaderExpiration: true,
        defaultExpirationInSeconds: IS_PRODUCTION ? 3600 : 60,
        expirationIsOnInterval: false,
        headersToRetain: '',
        hostId: 'my-api',
        pathId: 'default',
        encrypt: false
      }
    ]
  }
];

module.exports = connections;
```

Use `Config.getConnCacheProfile('my-api', 'default')` in services and DAOs to retrieve the cache profile.

Connections may be used for defining S3, DynamoDB, and other resources. Utilize host, path, and parameters and instead of passing to endpoint.send() or ApiRequest, create a custom fetch method.

## Responses (config/responses.js)

Configure response behavior including error TTLs and route expiration:

```javascript
const responses = {
  settings: {
    errorExpirationInSeconds: 300,
    routeExpirationInSeconds: 3600,
    externalRequestHeadroomInMs: 8000,
  },
  jsonResponses: {},
  htmlResponses: {},
  xmlResponses: {},
  rssResponses: {},
  textResponses: {},
};

module.exports = responses;
```

## Routing (routes/index.js)

`Routes.process(event, context)` creates the `ClientRequest` and `Response`, refuses unverified requests first, then reads `clientRequest.getProps()` and dispatches to the appropriate controller based on method, path, headers, or parameters. It returns the `Response`. The handler calls `finalize()`.

```javascript
const { tools: { DebugAndLog, ClientRequest, Response } } = require('@63klabs/cache-data');
const IngressGuard = require('../utils/ingress-guard');

const process = async (event, context) => {
  const clientRequest = new ClientRequest(event, context);
  const response = new Response(clientRequest);

  try {
    // >! The guard runs first, before validation, routing, or any data access
    if (IngressGuard.shouldRefuse(clientRequest)) {
      return IngressGuard.buildRefusal(response);
    }

    if (!clientRequest.isValid()) {
      return response.reset({ statusCode: 400 });
    }

    const props = clientRequest.getProps();
    const method = (props.method || '').toUpperCase();
    const pathArray = props.pathArray || [];

    // Route based on path and method
    if (pathArray[0] === 'users' && method === 'GET') {
      const UsersController = require('../controllers/users');
      await UsersController.get(props, response);
    } else {
      DebugAndLog.warn('No matching route', { method, path: props.path });
      response.reset({ statusCode: 404 });
    }
  } catch (error) {
    DebugAndLog.error(`Fatal error: ${error.message}`, error.stack);
    response.reset({ statusCode: 500 });
  }

  return response;
};

module.exports = { process };
```

`clientRequest.getProps()` returns an object with request properties including `method`, `path`, `pathArray`, `queryStringParameters`, `headers`, and more.

## Controllers

Controllers orchestrate business logic. They receive parsed request properties, call services, and populate the response. Controllers should not make direct data access calls.

```javascript
const { tools: { DebugAndLog, Timer } } = require('@63klabs/cache-data');
const UsersService = require('../services/users');

class UsersController {

  static async get(props, response) {
    const timer = new Timer("UsersController.get", true);
    try {
      const userId = props.pathArray[1] || null;
      const data = userId
        ? await UsersService.getById(userId)
        : await UsersService.list(props.queryStringParameters);

      response.setStatusCode(200);
      response.setBody(data);
    } catch (error) {
      DebugAndLog.error(`UsersController.get error: ${error.message}`, error.stack);
      response.setStatusCode(500);
      response.setBody({ error: 'Failed to retrieve users' });
    } finally {
      timer.stop();
    }
  }
}

module.exports = UsersController;
```

## Services

Services contain business logic and call DAOs or external APIs. They do not know about the HTTP request or response.

```javascript
const { tools: { DebugAndLog } } = require('@63klabs/cache-data');
const UsersDao = require('../models/users');

class UsersService {

  static async getById(userId) {
    const user = await UsersDao.fetchUser(userId);
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    return user;
  }

  static async list(queryParams) {
    return UsersDao.fetchUsers(queryParams);
  }
}

module.exports = UsersService;
```

## Models / Data Access Objects (DAOs)

DAOs handle data retrieval. For expensive operations (external API calls, batch AWS requests), use `CacheableDataAccess.getData()` to cache results automatically.

### Simple endpoint request (no caching)

Use `endpoint.send()` for straightforward HTTP requests:

```javascript
const { endpoint } = require('@63klabs/cache-data');

async function fetchData() {
  const response = await endpoint.send({
    host: 'api.example.com',
    path: '/data',
    parameters: { limit: '10' },
    headers: { 'Accept': 'application/json' }
  });
  return response.body;
}
```

### Cached data access

Use `CacheableDataAccess.getData()` for expensive requests that benefit from caching:

```javascript
const { cache: { CacheableDataAccess }, endpoint } = require('@63klabs/cache-data');
const { Config } = require('../config');

async function fetchUsersCached() {
  const { conn, cacheProfile } = Config.getConnCacheProfile('my-api', 'default');

  const connection = {
    ...conn,
    path: conn.path + '/users',
    headers: {}
  };

  const fetchFunction = async (connectionObj, query) => {
    return endpoint.send(connectionObj);
  };

  const result = await CacheableDataAccess.getData(
    cacheProfile,
    fetchFunction,
    connection,
    null, // query parameters that need to bypass cache key
    { path: 'users', id: 'user-list' } // cache key identifiers
  );

  return result;
}
```

### ApiRequest for advanced HTTP operations

Use `ApiRequest` when you need retry logic, pagination, or detailed X-Ray tracing:

```javascript
const { tools: { ApiRequest } } = require('@63klabs/cache-data');

const request = new ApiRequest({
  host: 'api.example.com',
  path: '/orders',
  parameters: { status: 'active' },
  retry: { enabled: true },           // automatic retry with backoff
  pagination: { enabled: true },       // automatic pagination
  xRay: { enabled: true, name: 'orders-api' }
});

const response = await request.send();
```

## Response Management

Always use the `Response` object from cache-data. Call `response.finalize()` exactly once at the end of the handler.

```javascript
const { tools: { Response } } = require('@63klabs/cache-data');

// Create response linked to the client request
const response = new Response(clientRequest);

// Set status and body
response.setStatusCode(200);
response.setBody({ users: [...] });

// Add custom headers
response.addHeader('X-Custom-Header', 'value');

// Finalize: stringifies JSON, sets CORS headers, sets cache-control,
// adds execution time header, logs the response to CloudWatch
return response.finalize();
```

`response.finalize()` handles:
- JSON body stringification
- CORS headers based on referrer validation
- Cache-control headers
- Execution time header
- CloudWatch logging of the response

## Logging and Debugging

Use `DebugAndLog` for all logging. It integrates with CloudWatch and respects the `CACHE_DATA_LOG_LEVEL` environment variable (0=ERROR through 5=DEBUG).

```javascript
const { tools: { DebugAndLog, Timer } } = require('@63klabs/cache-data');

// Log levels
DebugAndLog.error('Critical failure', errorStack);
DebugAndLog.warn('Unexpected condition', details);
DebugAndLog.log('Standard operation', data);
DebugAndLog.info('Informational', data);
DebugAndLog.debug('Debug detail', data);

// Timer for performance measurement
const timer = new Timer("operationName", true); // true = start immediately
// ... operation ...
DebugAndLog.log(timer.stop(), "TIMING");

// Environment check
const isProd = DebugAndLog.isProduction();
```

## Environment Variables

Common environment variables used by cache-data:

| Variable | Description |
|----------|-------------|
| `CACHE_DATA_LOG_LEVEL` | Log verbosity: 0 (ERROR) to 5 (DEBUG) |
| `CACHE_DATA_AWS_X_RAY_ON` | Enable X-Ray tracing (`true`/`false`) |
| `PARAM_STORE_PATH` | SSM Parameter Store path prefix |
| `CACHE_TABLE` | DynamoDB table name for cache storage |
| `CACHE_BUCKET` | S3 bucket name for large cached objects |
| `CACHE_DATA_TRUSTED_PROXY_HOPS` | Number of trusted proxies in front of the function. Always `"0"` in this project, so the client address is API Gateway's `requestContext.identity.sourceIp`, which is the viewer on a Regional API. Do not raise it. |
| `CACHE_DATA_INGRESS_SECRET_NAME` | Name or ARN of the secret that cache-data compares with the `X-Atlantis-Origin-Secret` header. The template sets it to the `OriginSecret` ARN only when `ApiIsBehindCloudFront` is `"true"`. When it is unset, the ingress guard is off. |

## Lambda Layers

For Cache-Data to function with Lambda Insights and SSM Parameters, the following layers must be used.



## Rules for AI Code Generation

When generating or modifying code in this project for Lambda functions behind API Gateway:

1. **Always use cache-data classes** for request handling, response generation, logging, and data access. Do not use raw `console.log`, manual CORS headers, or direct `https` module calls.

2. **Follow the MVC directory structure**. New routes go in `routes/`, business logic in `controllers/`, data access in `models/`, and shared utilities in `utils/`.

3. **Initialize outside the handler**. `Config.init()` and `Timer` for cold start measurement belong outside the handler function. Await `Config.promise()` and `Config.prime()` inside the handler.

4. **Use `CacheableDataAccess`** for any external API call or expensive AWS SDK operation that can benefit from caching. Define connection and cache profiles in `config/connections.js`.

5. **Use `endpoint.send()` or `ApiRequest`** for HTTP requests. These provide X-Ray tracing automatically. Use `ApiRequest` when you need retry, pagination, or detailed tracing.

6. **Call `response.finalize()` exactly once**. It handles CORS, cache-control, logging, and serialization. Do not manually set CORS headers or stringify the body.

7. **Use `DebugAndLog`** for all logging. Never use `console.log` directly.

8. **Use `Timer`** to measure performance of operations. Stop timers in `finally` blocks.

9. **Keep the handler thin**. The handler should only initialize, delegate to `Routes.process(event, context)` (which creates the request and response), and finalize. All logic belongs in controllers and services.

10. **Update `template-openapi-spec.yml`** when adding or modifying API endpoints. The OpenAPI spec is the primary validation and documentation layer.

11. **Run the ingress guard first in `Routes.process`**. Call `IngressGuard.shouldRefuse(clientRequest)` immediately after creating `ClientRequest` and `Response`, and before `isValid()`, routing, controllers, or cache access. Return `IngressGuard.buildRefusal(response)` when it is true. Do not read forwarding headers, the origin header, or `identity.sourceIp` in application code, and do not compare the origin secret yourself.
