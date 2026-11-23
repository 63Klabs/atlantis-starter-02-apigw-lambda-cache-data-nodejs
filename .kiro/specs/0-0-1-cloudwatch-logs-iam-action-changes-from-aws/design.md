# Design: CloudWatch Logs IAM action changes from AWS
> **Requirements**: [requirements.md](requirements.md)
> **Plan**: [PLAN.md](PLAN.md) (Locked, decisions 1 to 6)
## 1. Overview
One inline IAM statement is replaced by two, and one changelog entry is written.
1. In `application-infrastructure/template.yml`, `LambdaAccessToWriteLogs` (`logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` on a Log Stream ARN) becomes:
   - `LambdaAccessToWriteLogStreams`: `CreateLogStream` and `PutLogEvents` on the same Log Stream ARN as today.
   - `LambdaAccessToCreateLogGroup`: `CreateLogGroup` on the plain Log Group ARN.
2. The Template header version moves from `v2.0.7/2026-11-16` to `v2.0.8/<implementation date>`.
3. `CHANGELOG.md` gets one `### Changed` entry under `v0.0.1 (unreleased)` that tells owners of cloned starters how to make the same change.
Nothing else changes. No parameter, condition, resource, output, test, or document is added (requirements 4 and 9).
### 1.1 How each action maps to a resource type
| Action | Resource type AWS authorizes on | ARN form used | Statement |
|--------|---------------------------------|---------------|-----------|
| `logs:CreateLogGroup` | `log-group` | `arn:aws:logs:<region>:<account-id>:log-group:<name>` | `LambdaAccessToCreateLogGroup` |
| `logs:CreateLogStream` | `log-stream` | `arn:aws:logs:<region>:<account-id>:log-group:<name>:*` | `LambdaAccessToWriteLogStreams` |
| `logs:PutLogEvents` | `log-stream` | same as above | `LambdaAccessToWriteLogStreams` |
Source: Service Authorization Reference for Amazon CloudWatch Logs (`CreateLogGroup` requires `log-group*`, `CreateLogStream` requires `log-stream*`) and the CloudWatch Logs identity-based policy examples 3a and 3b. The `:*` form is accepted for the `log-stream` type, as example 3b shows.
### 1.2 What was verified while designing
| Fact | How it was checked | Result |
|------|--------------------|--------|
| `Fn::GetAtt Arn` on `AWS::Logs::LogGroup` ends in `:*` | CloudFormation `AWS::Logs::LogGroup` reference, return values | Confirmed |
| `Ref` on `AWS::Logs::LogGroup` returns the log group name | Same page, `Ref` section | Confirmed |
| `WebServiceLogGroup` does not depend on the Role | `template.yml:646-652` has no reference to the Role or the Policy | Confirmed |
| The `LambdaAccessToWriteLogs` Sid is referenced nowhere else | `grep -rn LambdaAccessToWriteLogs` over the repository, excluding specs: only `template.yml:583` | Confirmed |
| `sam validate --lint` passes on the unchanged Template with a current SAM CLI | SAM CLI 1.174.0: "is a valid SAM Template", exit 0. SAM CLI 1.143.0 failed with `E3030` for `nodejs24.x` | Confirmed (CLI updated, section 5.1) |
| Standalone `cfn-lint` 1.48.1 passes on the unchanged Template | Run on `template.yml`, no output | Confirmed |
| A plain Log Group ARN grants `CreateLogGroup` today | AWS documentation only. The workstation role cannot run IAM simulation, and the maintainer declined paid Access Analyzer checks (PLAN.md, Decision 6) | Documented, not tested |
## 2. Components and changes
| Component | Change | Requirements |
|-----------|--------|--------------|
| `application-infrastructure/template.yml`, `WebServiceLambdaExecutionRole` Policy | Replace one statement with two, add a comment | 1, 2, 3 |
| `application-infrastructure/template.yml`, header | Update the `# Version:` line | 5 |
| `CHANGELOG.md` | One entry under `v0.0.1 (unreleased)`, `### Changed`, replacing `- TODO` | 8 |
| Spec directory `tasks.md` notes | Lint output and the statement-by-statement read | 6, 7 |
Everything else in the repository is untouched (requirements 4 and 9).
## 3. Template design
### 3.1 Current statement (`template.yml:583-589`)
```yaml
          - Sid: LambdaAccessToWriteLogs
            Action:
            - logs:CreateLogGroup
            - logs:CreateLogStream
            - logs:PutLogEvents
            Effect: Allow
            Resource: !GetAtt WebServiceLogGroup.Arn
```
### 3.2 Final statements
The block replaces the lines above, at the same position (after the Policy's `Statement:` key and before `LambdaAccessToSSMParameters`). Indentation matches the neighbors: the `- Sid` item at 10 spaces, and `Action` with its list items at 12 spaces.
```yaml
          # CloudWatch Logs uses two ARN forms. Fn::GetAtt Arn on AWS::Logs::LogGroup returns a Log Stream ARN
          # (it ends in :*), which authorizes only the log stream actions. Log group actions need the plain
          # Log Group ARN. From April 26, 2027 AWS no longer accepts a Log Stream ARN for log group actions.
          - Sid: LambdaAccessToWriteLogStreams
            Action:
            - logs:CreateLogStream
            - logs:PutLogEvents
            Effect: Allow
            Resource: !GetAtt WebServiceLogGroup.Arn # Log Stream ARN (ends in :*)
          - Sid: LambdaAccessToCreateLogGroup
            Action:
            - logs:CreateLogGroup
            Effect: Allow
            Resource: !Sub 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WebServiceLogGroup}' # Log Group ARN (Ref is the log group name)
```
Design points:
- **Comment.** Requirement 3.3 asks for the `GetAtt` behavior, what a Log Stream ARN authorizes, and the 2027-04-26 date. The comment names none of the spec files (requirement 3.4).
- **Sid values.** They describe the action group and are unique within the Policy. `LambdaAccessToWriteLogs` disappears.
- **Order.** Stream statement first, group statement second, so a reader sees the existing ARN first and the new one second. The order has no effect on evaluation.
- **No `Condition`.** The Policy has none today and the new statements add none.
### 3.3 Resolved values
For a stack with `Prefix=acme`, `ProjectId=sample`, `StageId=test`, in Region `us-east-2` and account `123456789012`:
| Expression | Resolves to |
|------------|-------------|
| `!Ref WebServiceLogGroup` | `/aws/lambda/acme-sample-test-WebService` |
| `!GetAtt WebServiceLogGroup.Arn` | `arn:aws:logs:us-east-2:123456789012:log-group:/aws/lambda/acme-sample-test-WebService:*` |
| `!Sub 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WebServiceLogGroup}'` | `arn:aws:logs:us-east-2:123456789012:log-group:/aws/lambda/acme-sample-test-WebService` |
In `Fn::Sub`, `${WebServiceLogGroup}` resolves like `Ref`, which is the name above. The name starts with `/`, which is valid inside an ARN resource segment.
### 3.4 Dependency and update behavior
- `WebServiceLambdaExecutionRole` already depends on `WebServiceLogGroup` through the existing `GetAtt`. The new `Sub` adds the same dependency, so the order of creation is unchanged.
- `WebServiceLogGroup` has no reference to the Role (its properties are the name, `RetentionInDays`, and the two policies). No cycle is possible (requirement 6.3).
- The change edits `Policies` on an `AWS::IAM::Role`. CloudFormation updates inline policies with no interruption. `RoleName` is unchanged, so the Role is neither replaced nor renamed (requirement 4.8).
- All stages deploy the same statements. There are no conditions on this part of the Policy, so no stage differs.
- PROD gradual deployment is unaffected: the Role is shared by `$LATEST` and the `live` alias. Both versions of the function use the new policy as soon as CloudFormation updates it.
### 3.5 Header version
Line 8 of `template.yml`:
```yaml
# Version: v2.0.7/2026-11-16
```
becomes `# Version: v2.0.8/<YYYY-MM-DD of implementation>`. If the header has moved past `v2.0.7` by then, increment the patch number of whatever is there and use that number in the changelog entry (requirement 5.2).
### 3.6 What stays the same
- The three `Resource` expressions elsewhere in the Policy (`ssm`, the conditional `OriginSecret` statement).
- `ManagedPolicyArns` (`CloudWatchLambdaInsightsExecutionRolePolicy`, `AWSXRayDaemonWriteAccess`, and the imported Cache-Data policy), which are maintained outside this repository.
- `AccessLogSetting.DestinationArn: !GetAtt ApiGatewayAccessLogGroup.Arn`, which is not an IAM statement.
- `WebServiceLogGroup` and the two API Gateway log groups.
## 4. Changelog design
### 4.1 Placement
Version lookup (changelog steering file): `CHANGELOG.md` has exactly one `(unreleased)` heading, `## v0.0.1 (unreleased)`, so the entry goes there. The existing placeholder under `### Changed` is replaced:
```markdown
## v0.0.1 (unreleased)
### Changed
- TODO
```
The lookup is repeated in the final task (requirement 8.12). If a release has happened by then, the user is asked for the next version before any edit.
### 4.2 Entry text
Category `### Changed`: the Lambda execution role's permissions change, and no operator action is required for a new deployment of this starter. The entry is written for someone who copied the starter earlier and has not seen this repository's specs. The version in the title is the one set in section 3.5.
````markdown
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
````
Notes on the text:
- It names who is affected, what changed, and what to do, as the changelog steering file requires.
- It has no exploit detail and describes the AWS change in one sentence (requirement 8.11).
- Requirement 8.4 lists the four stream actions explicitly, so a reader can tell which statements need no change.
- The issue link uses the `Source` row of `ISSUE.md`, because `CHANGELOG.md` has no existing issue links and the maintainer imported this issue from that URL (requirement 8.9).
- The sibling spec leaves `CHANGELOG.md` unmodified by design. This spec is the exception, by the maintainer's Decision 4. The released changelog will contain a link to a spec directory that is not part of the release, which the maintainer accepted under the changelog steering file's link rule.
## 5. Verification design
### 5.1 Lint
- Command: `sam validate --lint -t application-infrastructure/template.yml`, run from the repository root with SAM CLI 1.174.0 or later. Expected: `... is a valid SAM Template`, exit code 0.
- The workstation SAM CLI was 1.143.0 and rejected `nodejs24.x` (`E3030`, not related to this change). On 2026-11-18 the CLI was updated to 1.174.0 by a user-level install (`~/.local/aws-sam-cli`, binary `~/.local/bin/sam`, which comes before `/usr/local/bin` on `PATH`). The system install (1.143.0 in `/usr/local/aws-sam-cli`) was left untouched, because replacing it needs `sudo`.
- Optional second check: standalone `cfn-lint application-infrastructure/template.yml`, which passes on the unchanged Template (cfn-lint 1.48.1).
- Run the lint once before editing and once after, and record both results in the `tasks.md` notes.
### 5.2 Statement read
No AWS API call is made (requirement 7.1). The implementer reads the final Policy and records a pass or fail for each line in the `tasks.md` notes:
| # | Check | Requirement |
|---|-------|-------------|
| R1 | `LambdaAccessToWriteLogStreams` lists exactly `logs:CreateLogStream` and `logs:PutLogEvents` | 1.1, 1.3 |
| R2 | Its `Resource` is `!GetAtt WebServiceLogGroup.Arn` | 1.2 |
| R3 | `LambdaAccessToCreateLogGroup` lists exactly `logs:CreateLogGroup` | 2.1 |
| R4 | Its `Resource` is the `!Sub` in section 3.2, with no `*` and no `:*` | 2.2, 2.3, 2.4 |
| R5 | No statement lists a Log Group action on a Log Stream ARN | 1.4 |
| R6 | No other statement, parameter, condition, resource, output, or file changed (`git diff --stat` shows only `template.yml` and `CHANGELOG.md` outside the spec directory) | 4, 9 |
| R7 | The `Sid` `LambdaAccessToWriteLogs` appears nowhere | 3.1 |
| R8 | The header `# Version:` line matches section 3.5 | 5.1 |
| R9 | The notes state that the plain Log Group ARN grant for `CreateLogGroup` is documented by AWS and not tested before deployment | 7.4 |
Each check can be done with `git diff` and `grep`, for example `git diff -- application-infrastructure/template.yml`, and `grep -rn "LambdaAccessToWriteLogs" . --exclude-dir=node_modules --exclude-dir=.git`.
### 5.3 After deployment (maintainer, read-only)
The checks V1 to V5 in `requirements.md` apply. In short: read the Role's inline policy (V1), confirm a request logs normally (V2), confirm the stack update shows the Role as `Modify` (V3), check permission boundaries and SCPs before 2027-04-26 (V4), and optionally run an IAM simulation for `CreateLogGroup` (V5, needs a role with the simulate permission).
## 6. Failure modes
| Situation | Behavior | Handling |
|-----------|----------|----------|
| A plain Log Group ARN does not grant `CreateLogGroup` (the one untested claim) | The Role cannot create a missing log group, starting at deployment. Normal logging is unaffected, because `WebServiceLogGroup` exists and the stream actions are on the Log Stream ARN | Optional V5 simulation. If it denies, put all three actions back in the stream statement and keep the group statement (fallback in requirement 7.5) |
| A permission boundary lists only Log Stream ARNs for `logs:` | The new `CreateLogGroup` grant is cut by the boundary. `CreateLogStream` and `PutLogEvents` still work | V4 check. The changelog entry tells owners to update the boundary |
| The deployed log group is deleted or renamed outside CloudFormation | Lambda tries to recreate it with `CreateLogGroup`, which is allowed on the exact name only | Intended. A different name is not allowed, which is least privilege |
| After April 26, 2027 an owner kept the old statement | `CreateLogGroup` is denied, normal logging still works | The changelog entry gives the fix |
| The CloudFormation service role cannot update the Role's inline policy | The pipeline update fails and rolls back, with no change to the running function | Not expected: the same permission is used when the Policy changes today |
| Rollback | Revert the Template. The previous statement returns | No data or state is affected |
## 7. Traceability
| Requirement | Design section |
|-------------|----------------|
| 1 Stream actions | 3.2, 5.2 (R1, R2, R5) |
| 2 Group action | 3.2, 3.3, 5.2 (R3, R4) |
| 3 Statement identifiers, placement, comment | 3.2, 5.2 (R7) |
| 4 No other infrastructure change | 3.4, 3.6, 5.2 (R6) |
| 5 Template version header | 3.5, 5.2 (R8) |
| 6 Validity | 3.4, 5.1 |
| 7 Policy verification | 1.2, 5.2, 5.3, 6 |
| 8 Changelog entry | 4 |
| 9 Release boundary | 2, 5.2 (R6) |
| 10 Platform constraints | 3.2 (no wildcard, naming unchanged), 3.4 (no new pipeline permission) |
## 8. Risks that affect the design
| Risk | Effect on the design | Mitigation |
|------|----------------------|------------|
| The plain Log Group ARN claim is untested before deployment | The split may leave `CreateLogGroup` denied | Fallback in section 6, optional V5 |
| `~/.local/bin/sam` (1.174.0) shadows the system `sam` (1.143.0) on this workstation | Other projects now use the newer CLI | The system install is untouched, and removing `~/.local/bin/sam` and `~/.local/aws-sam-cli` restores the old one |
| The changelog link to a spec directory may dangle in the released starter | A broken link in adopters' changelog | Accepted by the maintainer (Decision 4, section 4.2). Can be removed at release time by editing the unreleased entry |
| Other copies of the pattern in sibling repositories | Not handled here | Separate issues were submitted (PLAN.md, Decision 5) |
