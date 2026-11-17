# Deployment Guide

This application is **Ready-to-Deploy-and-Run** with the [63Klabs Atlantis DevOps Platform for Serverless Deployments on AWS](https://atlantis.63klabs.net)

- Use the Atlantis scripts from your organization's central SAM Config infrastructure repository to manage your application's repository and deployment.
- Add a pipeline to each branch in your repository you want to deploy from (`test`, `beta`, `main`)
- Make all code changes in the `dev` branch (or configure the approval/promotion option in the pipeline).
- To initiate a deployment, just merge your code from the `dev` branch to the `test` branch and push. This will kick-off the test deployment pipeline.
- You can subsequently deploy your code to the next branch/instance (`beta` and `main`/`prod`) by merging and pushing to each (or by configuring an approval/promotion option in the pipeline).

Follow your organization's guidelines for repository and pipeline management.

## Why Use Atlantis for Deployment?

Like any other project, you can skip the Atlantis platform and go at it on your own using `sam deploy` from the CLI within the application-infrastructure directory.

However, the [Atlantis DevOps Platform](https://atlantis.63klabs.net) is highly recommended for individual developers and small teams as it implements Platform Engineering, AWS best practices, and deployment automation. It utilizes AWS native resources including SAM deployments and CloudFormation without the need of proprietary DevOps tools. Everything is API, CloudFormation template, and SAM CLI based as well as AI-ready.

## Create Repository and Initialize with this Code

Using the Atlantis SAM Config scripts in your organization's central infrastructure repository:

```bash
./cli/create_repo.py YOUR_REPO_NAME --profile default
# Choose 02-apigw-lambda-cache-data-nodejs.zip

# Create a pipeline for the test branch
./cli/config.py pipeline PREFIX YOUR_PROJECT_ID test --profile default
# Choose template-pipeline.yml (CodeCommit source) or template-pipeline-github.yml

# Deploy the pipeline (if you didn't choose to deploy right away from the config script)
./cli/deploy.py pipeline PREFIX YOUR_PROJECT_ID test --profile default
```

Once the pipeline is created the first deployment will automatically kick off. You can follow it in the web console using the link provided in the Output.

Make sure it deploys without errors before going to the `dev` branch and making changes.

Clone the repository to your local machine:

```bash
git clone HTTPS_CLONE_URL

cd YOUR_CLONED_REPO

git switch dev
```

## Development and Deploy Process

Always make and commit your changes in `dev`

Perform merges to advance code to the next branch. `dev` -> `test` -> `beta` -> `main`

```bash
git switch dev
git switch test
git merge dev
git push
# Always return to dev for new changes
git switch dev
```

When you are ready to move code to the next stage, merge:

```bash
git switch test
git pull # always a good idea
git switch beta
git pull # always a good idea
git merge test
git push
# Always return to dev for new changes
git switch dev
```

### Setting Up Pipelines

For each branch/stage you wish to deploy from, set up a pipeline using your organization's central Atlantis SAM Config repository.

There are several pipeline configurations to choose from. If you prefer to not use the branch merge strategy (`dev` -> `test` -> `beta` -> `main`) you can configure the pipeline to use an approval and promotion strategy instead. Cross account configuration is also available.

All Atlantis pipeline templates support approval with promotion and cross-account deployment.

#### Standard Branch-Merge-Based

This will set up deployments for each branch and you will merge changes between them to deploy (`dev` -> `test` -> `beta` -> `main`).

- This is the least complex as it is all Git-based (no logging into the console for approvals.)
- **HOWEVER**: It requires discipline, only forward merges, and squash merges may produce unpredictable results.

Choose template-pipeline.yml (CodeCommit source) or template-pipeline-github.yml and do not enable the approval and promotion configuration. 

```bash
# Create a pipeline for the beta branch
./cli/config.py pipeline PREFIX YOUR_PROJECT_ID beta --profile default
# Choose template-pipeline.yml (CodeCommit source) or template-pipeline-github.yml

# Deploy the pipeline (if you didn't choose to deploy right away from the config script)
./cli/deploy.py pipeline PREFIX YOUR_PROJECT_ID beta --profile default
```

#### Approve/Promote and/or Cross-Account

> Cross-account deployments must use the approve/promote configuration.

This will set up an automatic Git-based deployment for the `test` branch but to deploy your application to subsequent stages you will need to:

1. Configure the `test` pipeline to promote to the next stage
2. All subsequent deployment stages use `template-pipeline-s3-source.yml`

Automated deployment process using approve/promote:

1. The test pipeline will still run automatically when changes are merged to the `test` branch.
2. Then, to promote to the next stage, go into the console for the test pipeline and choose approve promotion.
3. The pipeline will then drop the deployment artifact in an S3 bucket, triggering the next pipeline (which can either be in the same account, or in a separate PROD account depending on your organization's policies).
4. The receiving pipeline will then pick up the new artifact from S3 and await an approval to deploy.
5. The end of this pipeline can also have an approval/promote option. (In case you deploy from test to beta to prod).

You will still need to create one pipeline per stage and only the test branch will have a corresponding stage. (However, you _can_ set up the main branch, or any branch, to deploy to the initial "test" pipeline, it doesn't need to be the `test` branch. Just be sure to set the `StageId` to `test`). You can always create temporary pipelines using `template-pipeline.yml`/`template-pipeline-github.yml` for feature and bug fix test branches.

> By default approval is required to promote and deploy both at the end of the pipeline (promote) and at the start of the next stage (approve). This provides optimal protection against run-away deployments. If you want to disable either the promote or deploy approval, it is recommended you disable the deploy approval at the start of the receiving stage to avoid creating too many deploy artifact versions.

## CloudFront ingress and origin protection

This application's API is a **Regional** API Gateway REST API. It is meant to sit behind the CloudFront distribution that the Atlantis network stack creates for the stage. Origin protection makes the function answer `401` to any request that did not come through that distribution, so the raw `execute-api` URL cannot be used to skip it.

### What the starter does

| Item | Behavior |
|------|----------|
| API endpoint type | Always `REGIONAL`, in every stage and for every value of `ApiIsBehindCloudFront`. An edge-optimized API is not supported by this starter. If you need one, change `template.yml` yourself. |
| Client address | `CACHE_DATA_TRUSTED_PROXY_HOPS` is `"0"`. The client address in logs is the address API Gateway recorded (`requestContext.identity.sourceIp`), whether the request came through the distribution or straight to the API. A caller cannot choose it with a header such as `X-Forwarded-For`. Do not raise the value. |
| Origin secret | Every stage has a generated Secrets Manager secret named `Prefix-ProjectId-StageId-OriginSecret`. It is created whether or not enforcement is on, so the network stack can reference it before enforcement starts. It is not output, exported, or passed as a parameter. |
| `ApiIsBehindCloudFront` | The only switch for enforcement. Default `"false"`. It does **not** change the API endpoint type. |

When `ApiIsBehindCloudFront` is `"true"`:

- The function receives the secret's ARN in `CACHE_DATA_INGRESS_SECRET_NAME`, and its execution role may call `secretsmanager:GetSecretValue` on that one secret only.
- `@63klabs/cache-data` compares the `X-Atlantis-Origin-Secret` request header with the secret (the current value and the previous value). The application does no comparison of its own.
- A request that is not verified gets `401`, `Cache-Control: no-store`, and a fixed JSON body. The refusal happens first in request handling, before routing, validation, or any data access.
- API Gateway execution data tracing (`DataTraceEnabled`) is turned off in every environment, so request headers are not written to the `API-Gateway-Execution-Logs_*` log group. In PROD it is always off.

When `ApiIsBehindCloudFront` is `"false"`, there is no environment variable, no extra permission, and no guard. Requests are handled as before.

> The origin secret shows that a request passed through a distribution that holds the secret. It does not authenticate the caller. Authenticate callers in your application or with an authorizer.

### Setting the flag for a stage

`ApiIsBehindCloudFront` is set per branch and stage by editing a literal value in `application-infrastructure/template-configuration.json`:

```json
{
  "Parameters": {
    "ApiGatewayLoggingEnabled": "FALSE",
    "ApiIsBehindCloudFront": "false"
  }
}
```

(The file contains other parameters. Only the relevant ones are shown.)

- The value is a plain literal. It has no `$PLACEHOLDER$` and is not read from an environment variable.
- To change a stage, edit `"ApiIsBehindCloudFront"` to `"true"` or `"false"` on the branch that the stage deploys from, commit, and let the pipeline deploy.
- The `samconfig` `parameter_overrides` setting is not how this value is set.
- If you want to load the value from SSM parameters or another source of your own, you can, but the starter does not provide that.

> **Caution: the value moves forward with your merges.** The file merges forward `dev` -> `test` -> `beta` -> `main`. A `"true"` that is committed on one branch and then merged forward also switches the next stage when its pipeline deploys. If that stage's network stack does not yet send the origin header, **every request to that stage gets `401`**. Roll out one stage at a time, set `"true"` only after that stage's network stack already sends the header, and check the value in the file before every forward merge. If the next stage is not ready, merge with `git merge --no-commit`, set the value back to `"false"` in the merge commit, then push.

> If your pipelines use approve/promote instead of branch merges, the receiving stage deploys the artifact built earlier. Confirm how your pipeline carries `template-configuration.json` before you rely on a different value per stage.

### Adopt origin protection, one stage at a time

Do these three steps for each stage, in the order `test`, `beta`, `main` (stage `prod`). Finish one stage and confirm it works before you start the next.

1. **Deploy the application stack with `ApiIsBehindCloudFront` set to `"false"`.** This creates the origin secret. For an existing stage it also changes the API from edge-optimized to Regional in place. The `execute-api` hostname and the logical ID of the API do not change. See [Existing stages: check before the Regional switch](#existing-stages-check-before-the-regional-switch).
2. **Deploy the stage's network stack with `ApiOriginProtection=true`.** The distribution now sends `X-Atlantis-Origin-Secret` with the value of this stage's secret. Check that a request through the distribution still succeeds.
3. **Set `"ApiIsBehindCloudFront"` to `"true"` in `template-configuration.json` on that stage's branch, merge, and let the pipeline deploy.** The function now refuses requests without the secret.

> **Do not swap steps 2 and 3.** If the function enforces before the distribution sends the header, every request gets `401` (the log reason is `missing-header`). If this happens, set the flag back to `"false"` and deploy.

Then check that:

- A request through the distribution returns the normal response.
- A request to the raw `execute-api` URL without the secret returns `401` with `Cache-Control: no-store`.

### Roll back

In this order:

1. Set `"ApiIsBehindCloudFront"` to `"false"` on the stage's branch and let the pipeline deploy.
2. Deploy the network stack with `ApiOriginProtection=false`.

Do not stop the distribution from sending the header first, or every request gets `401` until the flag is `false`. The origin secret and the Regional endpoint stay in place after a rollback. Rollback does not return the API to edge-optimized.

### PROD gradual deployment

In PROD, CodeDeploy shifts the `live` alias to the new function version over the configured period. When you switch the flag, old and new function versions run side by side:

- The old version does not guard. It serves every request.
- The new version guards. It serves only requests that carry the secret.

If step 2 is done, the distribution sends the secret to both versions, so users see no outage during the shift. The raw `execute-api` URL is refused only by the new version, so it stays open for part of the shift period. The change of the API to Regional is applied immediately and does not depend on the shift. The same mixed behavior applies on rollback.

### Rotate the secret

Rotate in this order. Do not change `ApiOriginSecretRevision` early, because the function must hold the new value first.

1. Store a new value (48 letters and digits, no punctuation) as a new version of the stage's `Prefix-ProjectId-StageId-OriginSecret` secret. The old value becomes `AWSPREVIOUS`, and the function still accepts it.
2. Wait about 65 minutes. The function caches the secret for 3600 seconds by default, so this gives every warm function time to reload and hold both values.
3. Change `ApiOriginSecretRevision` on the stage's network stack and deploy it. The distribution starts to send the new value.
4. Wait until the network stack update shows `Deployed` (the distribution has finished propagating).
5. Remove the `AWSPREVIOUS` label from the old version so that the old value stops being accepted:

   ```bash
   aws secretsmanager list-secret-version-ids --secret-id Prefix-ProjectId-StageId-OriginSecret --profile default
   aws secretsmanager update-secret-version-stage --secret-id Prefix-ProjectId-StageId-OriginSecret \
     --version-stage AWSPREVIOUS --remove-from-version-id VERSION_ID_OF_THE_OLD_VALUE --profile default
   ```

### The secret: lifetime, access, and permissions

- **Deletion.** The secret is deleted with the application stack. Secrets Manager keeps a deleted secret for a recovery window, so recreating a stack with the same name can fail while the window is open. Plan for this before you delete and recreate a stage.
- **Who can read it.** Anyone with `secretsmanager:GetSecretValue` on the secret can read its value. So can anyone with `cloudfront:GetDistributionConfig` on the distribution, because the header value is part of the distribution's origin configuration. Grant those permissions with care.
- **Logs.** The function and cache-data do not write the secret. The sanitized `DEBUG` event log can show at most the last four characters of the header value. Keep `DEBUG` logging off in PROD.
- **Pipeline and service roles.** The pipeline's CloudFormation service role must be allowed to create, tag, and delete the secret (for example `secretsmanager:CreateSecret`, `secretsmanager:TagResource`, `secretsmanager:DeleteSecret`, `secretsmanager:GetRandomPassword`, and the matching describe and update actions). The network stack's service role must be allowed to read the secret by name. If your organization uses a permissions boundary, it must allow the same actions. Add these through the pipeline's managed policy settings (`CloudFormationSvcRoleIncludeManagedPolicyArns`), not by editing Atlantis templates.

### Where unverified requests appear

Each refused request writes an `[INGRESS_UNVERIFIED]` log line from `@63klabs/cache-data` with a reason code (for example `missing-header`, or `secret-unavailable` when the function cannot read the secret). The `[RESPONSE]` line shows status `401`. The reason code is never in the response sent to the caller.

- **PROD:** the dashboard widget "Error, Warning, and Unverified Request Log" includes these lines. The dashboard exists only in PROD.
- **TEST and other non-PROD stages:** there is no dashboard. Read the function's Lambda log group and filter for `INGRESS_UNVERIFIED`.
- The widget shows the newest 500 rows. A flood of unverified requests can push real errors out of view.
- No metric filter, alarm, or dedicated widget is provided. If you want a separate widget, metric, or alarm for unverified requests, add your own.

### Existing stages: check before the Regional switch

The first deployment of this version moves an existing stage from an edge-optimized to a Regional API. Before you merge it toward `test`, check:

- **Header names.** The case of header names in the event can differ from what the edge-optimized API delivered. Check any code that reads a header by an exact-case name. The starter's own code reads headers through `@63klabs/cache-data`.
- **`Content-MD5`.** An edge-optimized API removes this header. The Regional API passes it to the function, and may remap its name. Check any code that expects it to be missing or uses it.
- **Deployment.** The endpoint type changes in place, and the hostname stays the same.
