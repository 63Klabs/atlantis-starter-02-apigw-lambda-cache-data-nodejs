# API Gateway with Lambda utilizing 63klabs/cache-proxy Written in Node.js

> For use with template-pipeline.yml which can be deployed using [Atlantis Configuration Repository for Serverless Deployments using AWS SAM](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)

An application starter template to demonstrate Atlantis Template for AWS CodePipeline to provision a web service that utilizes API Gateway and a simple Lambda function written in Node.js that implements various features of the [@63klabs/cache-data](https://www.npmjs.com/package/@63klabs/cache-data) NPM package.

## Features

- API Gateway implementation (with additional logging if enabled)
- Lambda Function with gradual deployment and rollback in production environments
- AWS X-Ray Tracing between API Gateway, Lambda, S3, DynamoDb, and remote endpoints
- Lambda Insights, CloudWatch logs, and a CloudWatch Dashboard for monitoring performance
- Cache-Data implementation:
  - Configuration: Connections, SSM Parameter Store Secrets, Cache
  - Logging: DebugAndLog, Timer
  - Caching of data from remote endpoints using S3 and DynamoDb (provision separately or with application)
  - Request handling: Router, Validation, response formatting and logging

## Tutorial: Installation and Use

Read the [Atlantis Tutorials introductory page](https://github.com/63Klabs/atlantis-tutorials), then perform the steps outlined in the [S3 and DynamoDb storage stack for API Gateway and Lambda using Cache-Data (Node) tutorial](https://github.com/63Klabs/atlantis-tutorials/tree/main/tutorials/02-s3-dynamo-api-gateway-lambda-cache-data-node).
