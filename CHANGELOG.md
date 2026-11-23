# Changelog

All notable changes to the Atlantis with Kiro AI assets will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## v0.0.1 (unreleased)

### Changed

- **template.yml v2.0.8: CloudWatch Logs permissions use the correct ARN for each action** - The Lambda execution role statement `LambdaAccessToWriteLogs` is now two statements. `logs:CreateLogGroup` is allowed on the Log Group ARN, and `logs:CreateLogStream` and `logs:PutLogEvents` stay on the Log Stream ARN (`!GetAtt WebServiceLogGroup.Arn`, which ends in `:*`). AWS is changing CloudWatch Logs authorization: starting April 26, 2027 (rolled out region by region), a Log Stream ARN no longer grants Log Group actions, so the old statement would stop allowing `CreateLogGroup`. Affects applications created from earlier versions of this starter. [Spec: 0-0-1-cloudwatch-logs-iam-action-changes-from-aws](.kiro/specs/0-0-1-cloudwatch-logs-iam-action-changes-from-aws/) addresses [#15](https://github.com/63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/issues/15)
  - **What to do:** In your own template, find every `Allow` statement for `logs:` actions whose resource is a Log Stream ARN (ends in `:*` or `:log-stream:<name>`) and that lists any action other than `logs:CreateLogStream`, `logs:PutLogEvents`, `logs:GetLogEvents`, and `logs:DeleteLogStream`. For each one, add an equivalent statement on the Log Group ARN, and keep the existing Log Stream ARN statement. Finish before April 26, 2027.
  - **Permission boundaries and SCPs:** If a permissions boundary or service control policy scopes `logs:` resources with `:*`, it must also allow the Log Group ARN.
  - **Example:**
    ```yaml
    # Before
    - Sid: LambdaAccessToWriteLogs
      Action:
      - logs:CreateLogGroup
      - logs:CreateLogStream
      - logs:PutLogEvents
      Effect: Allow
      Resource: !GetAtt WebServiceLogGroup.Arn
    # After
    - Sid: LambdaAccessToWriteLogStreams
      Action:
      - logs:CreateLogStream
      - logs:PutLogEvents
      Effect: Allow
      Resource: !GetAtt WebServiceLogGroup.Arn
    - Sid: LambdaAccessToCreateLogGroup
      Action:
      - logs:CreateLogGroup
      Effect: Allow
      Resource: !Sub 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WebServiceLogGroup}'
    ```