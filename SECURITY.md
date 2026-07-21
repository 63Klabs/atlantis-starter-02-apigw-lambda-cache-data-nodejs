# Security Policy

This repository is built with security best practices in mind. 

It demonstrates and encourages:
- Failing deployments when dependency vulnerability checks fail
- Implementing role-based access with the Principle of Least Privilege
- Standardizing tagging and naming conventions to better scope access policies
- Use of SSM Parameter Store and Secrets Manager for sensitive information
- Retaining logs for a limited time and purging after expiration

It is the responsibility of the developer/maintainer of any repository that was cloned, forked, copied, or otherwise, to:
- Maintain and improve upon practices described above
- Update all external Python libraries and Node packages to secure versions
- Update Lambda layers regularly to latest versions
- Practice safe coding and scripting
- Utilize industry best practices and standards for security

If using Kiro, there are manual steering files provided to assist in keeping dependencies and Lambda Layers current:
- `.kiro/steering/`
  - `audit-update-npm-packages`
  - `audit-update-python-packages`
  - `update-lambda-layers`

These are manual steering files (`inclusion: manual`), so they stay dormant until you invoke them. To run one, reference it in the Kiro chat with the `#` context key (for example, `#update-lambda-layers`) and send the message. Kiro will then follow the steps described in that file.

## Reporting a Vulnerability

This repository was created using [Atlantis Starter #02](https://github.com/63klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/) as a template.

### Starter Code

If a developer using the Starter finds a **vulnerability in the code or configuration provided by the starter**, they are encouraged to report it using the [Security and quality](https://github.com/63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/security) section of the original GitHub repository.

### Custom Code

If a developer or end user discovers a **vulnerability in modified starter code** then they are encouraged to report it using the methods described in the repository from which they retrieved the code.