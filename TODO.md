# First Deployment Checklist

This is a bare-bones rundown of what needs to be done to deploy this application starter.

> For use with template-pipeline.yml which can be deployed using [Atlantis Configuration Repository for Serverless Deployments using AWS SAM](https://github.com/63Klabs/atlantis-cfn-configuration-repo-for-serverless-deployments)

For a tutorial on how to use this application starter template and 63klabs/cache data, see [API Gateway and Lambda using Cache-Data (Node)](https://github.com/63Klabs/atlantis-tutorials/blob/main/tutorials/02-advanced-api-gateway-lambda-cache-data-node/README.md)

If you are not confident working within the Atlantis framework (or AWS Api Gateway, Lambda, and CloudFormation in general), please refer back to the various [tutorials provided by 63Klabs](https://github.com/63Klabs/atlantis-tutorials) as they assist in placing your application in a maintainable CI/CD pipeline using AWS SAM and CloudFormation.

> On first deploy it is recommened you deploy the starter as-is to ensure you have the repository and CI/CD set up properly!

## Prereq

-

## First deploy

- [ ] Make sure you or your organization has a Cache-Data storage stack
- [ ] Place this code in a repository and create a test deploy branch
- [ ] Create pipeline for deploying test branch
- [ ] After first deploy, visit endpoint to ensure success

## Code your application


