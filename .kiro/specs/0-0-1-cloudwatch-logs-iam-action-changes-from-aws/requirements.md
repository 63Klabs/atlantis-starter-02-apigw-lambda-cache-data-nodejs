# Requirements: CloudWatch Logs IAM action changes from AWS
> **Source**: [PLAN.md](PLAN.md) (Locked, 2026-11-18), derived from [ISSUE.md](ISSUE.md) (GitHub #15)
> **Spec version**: 0-0-1 (from `CHANGELOG.md`, `v0.0.1 (unreleased)`)
## Introduction
Starting 2027-04-26, AWS will authorize CloudWatch Logs Log Group actions only for IAM statements that use a Log Group ARN. A Log Stream ARN (ending in `:*` or `:log-stream:<name>`) will no longer grant them. `CreateLogStream`, `PutLogEvents`, `GetLogEvents`, and `DeleteLogStream` stay Log Stream actions.
This starter has one affected statement: `LambdaAccessToWriteLogs` on `WebServiceLambdaExecutionRole`. It lists `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` on `!GetAtt WebServiceLogGroup.Arn`, which ends in `:*`. After the AWS change, `CreateLogGroup` would no longer be granted.
This change splits that statement by resource type, so each action sits under the ARN form it is authorized on. It touches `application-infrastructure/template.yml` and `CHANGELOG.md` only. Other Atlantis repositories are handled in separate issues and are out of scope.
## Glossary
- **Template**: `application-infrastructure/template.yml`.
- **Role**: the `WebServiceLambdaExecutionRole` resource in the Template.
- **Policy**: the inline policy `WebServiceLambdaResourceAccessPolicies` of the Role.
- **Log group resource**: the `WebServiceLogGroup` resource in the Template.
- **Log Stream ARN**: an ARN that ends in `:*` or `:log-stream:<name>`. `Fn::GetAtt Arn` on an `AWS::Logs::LogGroup` returns this form.
- **Log Group ARN**: `arn:aws:logs:<region>:<account-id>:log-group:<log-group-name>`, with no `:*` suffix.
- **Stream actions**: `logs:CreateLogStream` and `logs:PutLogEvents`, the Log Stream actions this Template uses.
- **Group action**: `logs:CreateLogGroup`, the only Log Group action this Template uses.
- **Changelog**: `CHANGELOG.md` at the repository root.
- **Spec directory**: `.kiro/specs/0-0-1-cloudwatch-logs-iam-action-changes-from-aws/`.
## Requirements
### Requirement 1: Stream actions on the Log Stream ARN
**User Story:** As an operator, I want the Lambda function to keep writing log events, so that logging does not stop before, during, or after the AWS rollout.
#### Acceptance Criteria
1. THE Policy SHALL contain one `Allow` statement whose `Action` list is exactly `logs:CreateLogStream` and `logs:PutLogEvents`.
2. THE `Resource` of that statement SHALL be `!GetAtt WebServiceLogGroup.Arn`, the Log Stream ARN of the Log group resource.
3. THE statement SHALL NOT list `logs:CreateLogGroup` or any other action.
4. THE Policy SHALL contain no `Allow` statement that lists a Log Group action and has a Log Stream ARN as its resource.
### Requirement 2: Group action on the Log Group ARN
**User Story:** As an operator, I want the function to be able to recreate its log group if it is missing, so that logging recovers without a stack update.
#### Acceptance Criteria
1. THE Policy SHALL contain one separate `Allow` statement whose `Action` list is exactly `logs:CreateLogGroup`.
2. THE `Resource` of that statement SHALL be the Log Group ARN of the Log group resource, written as `!Sub 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WebServiceLogGroup}'`.
3. THE `Resource` SHALL NOT end in `:*`, and SHALL NOT contain a `*` anywhere.
4. THE `Resource` SHALL name only the Log group resource, not all log groups in the account or Region.
5. THE statement SHALL NOT be added as a duplicate of the stream statement with all three actions.
### Requirement 3: Statement identifiers and placement
**User Story:** As a maintainer, I want the statements to be easy to find and read, so that the next developer picks the right ARN form for any action they add.
#### Acceptance Criteria
1. THE Policy SHALL replace the statement with `Sid: LambdaAccessToWriteLogs` by two statements with these `Sid` values: `LambdaAccessToWriteLogStreams` (Requirement 1) and `LambdaAccessToCreateLogGroup` (Requirement 2).
2. THE two statements SHALL appear in the same position in the Policy that `LambdaAccessToWriteLogs` held, before `LambdaAccessToSSMParameters`.
3. A comment immediately above the two statements SHALL state that `Fn::GetAtt Arn` on `AWS::Logs::LogGroup` returns a Log Stream ARN ending in `:*`, that Log Stream ARNs authorize only the stream actions, and that Log Group actions need the plain Log Group ARN (AWS change effective 2027-04-26).
4. THE comment SHALL NOT reference the Spec directory, PLAN, ISSUE, or requirements files.
### Requirement 4: No other infrastructure change
**User Story:** As an operator, I want this change to stay small, so that it deploys as an in-place update of one inline policy.
#### Acceptance Criteria
1. THE change SHALL NOT edit any statement of the Policy other than `LambdaAccessToWriteLogs`.
2. THE change SHALL NOT change `ManagedPolicyArns`, `PermissionsBoundary`, `AssumeRolePolicyDocument`, `RoleName`, `Path`, or the logical ID of the Role.
3. THE change SHALL NOT change the logical ID, `LogGroupName`, `RetentionInDays`, `DeletionPolicy`, or `UpdateReplacePolicy` of the Log group resource, or of `ApiGatewayAccessLogGroup` or `ApiGatewayExecutionLogGroup`.
4. THE change SHALL NOT change `AccessLogSetting.DestinationArn` of `WebApi`.
5. THE change SHALL NOT add or change a parameter, condition, mapping, resource, output, or export in the Template.
6. THE change SHALL NOT edit `template-dashboard.yml`, `template-openapi-spec.yml`, `template-configuration.json`, `buildspec.yml`, or any file under `application-infrastructure/src/` or `application-infrastructure/build-scripts/`.
7. THE change SHALL NOT edit upstream Atlantis platform templates or duplicate them, as required by `AGENTS.md` section 2.1.
8. THE Template SHALL remain deployable without replacing the Role or the Log group resource, so that CloudFormation reports the Role as an in-place update.
### Requirement 5: Template version header
**User Story:** As a maintainer, I want the template header to show that the Template changed, so that adopters can tell which copy of the starter they have.
#### Acceptance Criteria
1. THE `# Version:` line in the Template header SHALL be updated from `v2.0.7/2026-11-16` to the next patch number, `v2.0.8`, with the date on which the change is implemented in `YYYY-MM-DD` form.
2. IF the Template header version has already moved past `v2.0.7` when the change is implemented, THEN THE implementer SHALL increment the patch number of the version found at that time and use that version in the Changelog entry (Requirement 8).
### Requirement 6: Validity of the Template
**User Story:** As an operator, I want the changed Template to pass validation, so that the pipeline does not fail on deploy.
#### Acceptance Criteria
1. WHEN `sam validate --lint -t application-infrastructure/template.yml` is run with SAM CLI 1.174.0 or later, THE result SHALL report the Template as a valid SAM Template, with exit code 0. (SAM CLI 1.143.0 rejects `nodejs24.x` with `E3030`, which is not caused by this change.)
2. THE two new statements SHALL use the same YAML indentation style as the neighboring statements of the Policy (two-space indentation, `Action` list items at the same level as the existing statements).
3. THE new `Resource` expression SHALL NOT create a circular dependency. The Log group resource SHALL NOT reference the Role or the Policy.
### Requirement 7: Policy verification
**User Story:** As a maintainer, I want evidence that the new statements grant only the intended access, so that the issue's "verify the updated policy" step is satisfied without a deployment and without extra cost or access.
#### Acceptance Criteria
1. THE implementer SHALL NOT call `aws iam simulate-custom-policy`, `aws iam simulate-principal-policy`, or any IAM Access Analyzer policy check for this change, and SHALL NOT make any AWS API call for it. The AWS profile in use on the workstation has no `iam:SimulateCustomPolicy` permission, and Access Analyzer custom policy checks incur a charge.
2. THE verification before deployment SHALL consist of the lint in Requirement 6 and a statement-by-statement read of the final Policy against the AWS CloudWatch Logs documentation page "Using identity-based policies (IAM policies) for CloudWatch Logs" (examples 3a, 3b, and 3c), with the result written in the notes of the Spec directory's `tasks.md`.
3. THE read SHALL confirm, for the final Policy: the Group action is on a Log Group ARN with no `:*`; the Stream actions are on a Log Stream ARN; no statement lists a Log Group action on a Log Stream ARN; no `Resource` contains a `*` other than the `:*` suffix of the Log Stream ARN produced by `Fn::GetAtt`; and no action was added beyond the three in the original statement.
4. THE notes SHALL state that the claim "a Log Group ARN without `:*` grants `logs:CreateLogGroup` today" rests on the AWS documentation and is not tested before deployment.
5. THE maintainer MAY run a policy simulation in the IAM console or with a role that has `iam:SimulateCustomPolicy`. IF that simulation shows `implicitDeny` for `logs:CreateLogGroup` on the Log Group ARN, THEN THE maintainer SHALL reopen the plan, and the agreed fallback is to keep all three actions in both statements.
### Requirement 8: Changelog entry
**User Story:** As an owner of an application cloned from this starter, I want the changelog to tell me what to change in my own template, so that my Lambda functions keep logging after 2027-04-26.
#### Acceptance Criteria
1. THE Changelog SHALL receive one entry under `## v0.0.1 (unreleased)`, in the category `### Changed`, replacing the placeholder line `- TODO`.
2. THE entry SHALL follow the entry format of the changelog steering file: the component and its version in bold (`template.yml v2.0.8`, or the version from Requirement 5), then ` - `, the description, then the spec link, then the issue link.
3. THE description SHALL state what changed: `CreateLogGroup` moved to a statement on the Log Group ARN, and the stream actions stay on the Log Stream ARN.
4. THE description SHALL state who is affected: the starter's Lambda execution role, and any `Allow` statement in a template copied from this starter or written the same way, where the resource is a Log Stream ARN (ending in `:*` or `:log-stream:<name>`) and the actions include anything other than `CreateLogStream`, `PutLogEvents`, `GetLogEvents`, and `DeleteLogStream`.
5. THE description SHALL state what to do: add an equivalent `Allow` statement with the Log Group ARN, keep the existing Log Stream ARN statement, and finish before 2027-04-26 (AWS rolls out region by region).
6. THE description SHALL state that a permissions boundary or service control policy that scopes `logs:` resources with `:*` must also allow the Log Group ARN.
7. THE entry SHALL contain a short before and after example of the changed statement, in a sub-bullet or a fenced block under the entry, so that a reader can apply it without opening the template.
8. THE spec link SHALL be `[Spec: 0-0-1-cloudwatch-logs-iam-action-changes-from-aws](.kiro/specs/0-0-1-cloudwatch-logs-iam-action-changes-from-aws/)`, as required by the changelog steering file.
9. THE issue link SHALL be `addresses [#15](<issue-url>)`, where the issues URL is taken from the `Source` row of `ISSUE.md` (`https://github.com/63Klabs/atlantis-starter-02-apigw-lambda-cache-data-nodejs/issues/15`).
10. THE change SHALL NOT write a release date, choose a release version, or edit any dated section or the intro text of the Changelog.
11. THE entry SHALL NOT contain exploit detail. It SHALL NOT describe the AWS change in more detail than the sentence in the Introduction.
12. WHEN the final task of `tasks.md` runs, THE implementer SHALL repeat the changelog version lookup, because a release may have happened since the spec started.
### Requirement 9: Release boundary
**User Story:** As a maintainer, I want the released starter to carry only what adopters need, so that no test tooling or spec material is added.
#### Acceptance Criteria
1. THE change SHALL NOT add a test file, jest configuration, test dependency, test script, or test documentation anywhere in the repository.
2. THE change SHALL NOT edit `DEPLOYMENT.md`, `README.md`, `ARCHITECTURE.md`, `TODO.md`, any file under `docs/`, or any steering or skill file.
3. THE only files edited outside the Spec directory SHALL be `application-infrastructure/template.yml` and `CHANGELOG.md`.
4. THE Template SHALL NOT mention the Spec directory or the files in it.
5. WHEN the change is ready for release, THE maintainer SHALL review the diff outside `.kiro/specs/0-0-1-*` and confirm it contains only the two files in criterion 3.
### Requirement 10: Constraints from the platform
**User Story:** As a platform engineer, I want this change to respect the Atlantis guardrails, so that it deploys through the existing pipeline.
#### Acceptance Criteria
1. THE change SHALL keep resource names in the form `<Prefix>-<ProjectId>-<StageId>-<ResourceId>`.
2. THE change SHALL NOT widen any permission, and SHALL NOT use `arn:aws:logs:*:*:*` or any wildcard log group.
3. THE change SHALL be deployable through the existing CI/CD pipeline without a manual console step.
4. THE change SHALL NOT require a new permission for the pipeline's CloudFormation service role beyond what it already needs to update this inline policy.
## Out of Scope
- Other starters, `serverless-cloudfront-cache-invalidation`, `atlantis-mcp`, `atlantis-sam-templates`, and steering or skill guidance. Issues for these were submitted separately (PLAN.md, Decision 5).
- A `DEPLOYMENT.md` section, README, or other documentation beyond the Changelog entry (PLAN.md, Decision 4).
- Any automated test, test harness, or test documentation (PLAN.md, Decision 3).
- `${AWS::Partition}` in ARNs. The Template hard-codes `arn:aws:` elsewhere, and a partition change is a separate change (PLAN.md, Decision 2).
- The `DestinationArn` used for API Gateway access logs, which is not an IAM statement.
- Permission boundaries, SCPs, and the account-level API Gateway CloudWatch role, which are maintained outside this repository.
## Verification After Deployment
These checks run on a deployed stage. The maintainer performs them. They are read-only and are not required to implement the change.
| # | Check | Where |
|---|-------|-------|
| V1 | `aws iam get-role-policy` for the Role's `WebServiceLambdaResourceAccessPolicies` shows the two new statements and no `LambdaAccessToWriteLogs` | TEST, then each stage |
| V2 | A request through the stage succeeds, and a new log stream and log events appear in `/aws/lambda/<Prefix>-<ProjectId>-<StageId>-WebService` | TEST, then each stage |
| V3 | The stack update shows the Role as `Modify`, not `Replace`, in the change set or stack events | TEST |
| V4 | A permission boundary or SCP in the target account does not scope `logs:` resources with `:*` only | Each account, before 2027-04-26 |
| V5 | Optional: an IAM policy simulation for the Role shows `logs:CreateLogGroup` allowed on the Log Group ARN of `WebServiceLogGroup` (needs `iam:SimulateCustomPolicy` or `iam:SimulatePrincipalPolicy`, which the workstation role lacks) | Maintainer, any stage |
