# CloudWatch Logs IAM action changes from AWS

> **Status**: Locked, 2026-11-18 (all four questions answered)
> **Issue**: [ISSUE.md](ISSUE.md) (GitHub #15)
> **Reviewed against**: `dev` at `60318a2` on 2026-11-18 (working tree has one unrelated modified file, `.kiro/specs/0-0-1-adopt-the-atlantis-ingress-standard-regional-api/tasks.md`)

## 1. Summary

AWS will stop letting a Log Stream ARN (`...:log-group:<name>:*`) authorize Log Group level actions on 2027-04-26. This starter has exactly one IAM statement that is affected: `LambdaAccessToWriteLogs` on `WebServiceLambdaExecutionRole`. It allows `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` on `!GetAtt WebServiceLogGroup.Arn`. For `AWS::Logs::LogGroup`, `Fn::GetAtt Arn` returns an ARN that ends in `:*`, so the statement is a Log Stream ARN. `CreateLogStream` and `PutLogEvents` keep working. `CreateLogGroup` is the only action that loses its grant.

In practice the function still logs after the cutover, because the template creates `WebServiceLogGroup` and Lambda only calls `CreateLogGroup` when the group is missing. The risk is the case where the group is deleted or drifts, and the function then cannot recreate it.

The fix is a small, in-place edit of one policy statement in `application-infrastructure/template.yml`: grant `CreateLogGroup` on a plain Log Group ARN, keep the Log Stream ARN for the stream actions, and record the change in `CHANGELOG.md` for developers who already cloned the starter. No other IAM statement in this repository references CloudWatch Logs. Scope is this repository only: issues for the other affected Atlantis repositories were already submitted separately.

## 2. Assessment of the issue

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| C1 | Starter templates contain ALLOW statements with a Log Stream ARN that mix in Log Group actions | Confirmed, one statement | `application-infrastructure/template.yml:583-589`: `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents` on `!GetAtt WebServiceLogGroup.Arn`. |
| C2 | `!GetAtt <LogGroup>.Arn` produces a Log Stream style ARN (`:*`) | Confirmed | CloudFormation `AWS::Logs::LogGroup` reference, `Fn::GetAtt Arn`: "`arn:aws:logs:us-west-1:123456789012:log-group:/mystack-testgroup-12ABC1AB12A1:*`". Not inferable from the issue, which does not mention `GetAtt`. |
| C3 | `CreateLogStream`, `PutLogEvents`, `GetLogEvents`, `DeleteLogStream` stay Log Stream scoped | Confirmed | Service Authorization Reference for CloudWatch Logs lists `CreateLogStream` with required resource type `log-stream*`. `CreateLogGroup` lists `log-group*`. |
| C4 | A Log Group ARN without `:*` already grants Log Group actions today | Confirmed by docs only, not tested | CloudWatch Logs identity-based policy examples 3a and 3c show the standard `log-group:<name>` ARN for log-group actions. A pre-deploy simulation was not possible: the workstation's `PowerUserAccess` role has no `iam:SimulateCustomPolicy`, and the maintainer chose not to use paid Access Analyzer checks (Decision 6). |
| C5 | Other starters and Atlantis pieces share the pattern | Out of scope | Tracked in separate issues already submitted by the maintainer. Not examined further here. |
| C6 | Account-wide and prefix-based Atlantis infrastructure also needs updating | Out of scope | Tracked in separate issues. The one platform artifact this starter imports, the Cache-Data managed policy (`template-storage-cache-data` v0.0.15), has no `logs:` statement. |
| C7 | Starter apps do not receive Atlantis updates | Confirmed | `AGENTS.md` section 2.1: platform templates are deployed separately. The starter's `template.yml` is copied into each application. |

## 3. Current state

- **The one affected statement.** `template.yml:583-589` sits in inline policy `WebServiceLambdaResourceAccessPolicies` of `WebServiceLambdaExecutionRole` (`template.yml:553-`). The statement was written in the initial commit (`41a490a`) with `!GetAtt AppLogGroup.Arn` and only retargeted to `WebServiceLogGroup` in `b6ad721` (multi-resource-src rename). Nothing indicates the `:*` form was a deliberate choice.
- **The log group is created by the template.** `WebServiceLogGroup` (`template.yml:646-652`) has a fixed name `/aws/lambda/${Prefix}-${ProjectId}-${StageId}-WebService`. The comment there says it avoids a circular reference with the function. `CreateLogGroup` is therefore a fallback, not part of normal operation.
- **Managed policies on the role are not ours to edit.** `CloudWatchLambdaInsightsExecutionRolePolicy` and `AWSXRayDaemonWriteAccess` are AWS-managed. The Cache-Data managed policy imported from the Atlantis storage stack contains only S3 and DynamoDB statements (checked through the Atlantis MCP, `template-storage-cache-data`).
- **Other log groups in this template are not IAM statements.** `ApiGatewayAccessLogGroup` is used as `DestinationArn: !GetAtt ApiGatewayAccessLogGroup.Arn` (`template.yml:395`). API Gateway writes through the account-level CloudWatch role that an admin sets up (comment at `template.yml:389`), which is not defined here. `ApiGatewayExecutionLogGroup` is only a log group. See G2 for the one open check on `DestinationArn`.
- **No other references.** A grep for `logs:`, `log-group`, and `log-stream` across the repository (excluding specs and `node_modules`) finds only `template.yml`. `template-dashboard.yml` has CloudWatch Logs Insights queries but no IAM. `buildspec.yml` and `build-scripts/` have none.
- **Conventions that apply.** `AGENTS.md` section 2.1 and `.kiro/steering/atlantis-multi-resource-src.md` forbid editing upstream Atlantis templates, so only `application-infrastructure/template.yml` changes. Existing ARNs in this template hard-code the partition (`arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter...`, `template.yml` near line 597), so the new ARN follows that. Sibling spec `0-0-1-adopt-the-atlantis-ingress-standard-regional-api` is locked and touched the same role's policy list (the `OriginSecret` statement), which is the only coordination point.
- **Changelog.** `CHANGELOG.md` has an open `## v0.0.1 (unreleased)` section with a placeholder `### Changed` entry (`- TODO`). The changelog steering file requires entries in the last task of `tasks.md` and a version check before the spec starts.

## 4. Review

### 4.1 Security

- Least privilege holds. The new statement grants one action (`CreateLogGroup`) on one named log group, not on `log-group:*`. The stream statement stays scoped to the function's own group.
- Do not widen to satisfy the notice. A tempting shortcut is `arn:aws:logs:*:*:*` (the AWS docs' introductory example). It would hide the problem and break the Prefix-based scoping model in `AGENTS.md`.
- `CreateLogGroup` is arguably unneeded because the template creates the group. Removing it would be the strictest option, but it changes behavior (rejected in Decision 1).
- This is a platform-wide IAM behavior change announced by AWS, not an exploitable weakness. No disclosure handling is needed for the spec directory.

### 4.2 Software engineering

- **Change size.** About 10 lines of YAML in one file. A proportionate plan has few steps.
- **Statement design.** Only `CreateLogGroup` needs the Log Group ARN. Splitting it into its own statement is clearer than duplicating all three actions into both statements, and avoids leaving a dead action in the stream statement after April 2027 (Decision 1).
- **ARN construction.** `!GetAtt WebServiceLogGroup.Arn` cannot be reused for the group ARN. `!Sub 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WebServiceLogGroup}'` works because `Ref` on `AWS::Logs::LogGroup` returns the log group name. It keeps the implicit dependency and does not repeat the name pattern. It does not create a circular reference, since `WebServiceLogGroup` does not depend on the role (Decision 2).
- **Tests.** No existing test covers the template's IAM. `application-infrastructure/src/lambda/web-service/tests` tests Lambda code only. The locked sibling spec has a spec-local jest harness that resolves `template.yml`, which is the only reusable test tooling, not used (Decision 3).
- **Docs.** No shipped document describes the log permission. Developers who already cloned this starter do not get the fix automatically, so the changelog entry carries the guidance (Decision 4).

### 4.3 Cloud engineering

- **Deployment impact.** An inline policy edit on an existing role is an in-place update, not a replacement. No parameters, conditions, or stack boundaries change. All stages (test, beta, prod) get the same statement, so no per-stage drift. The pipeline's CloudFormation service role already manages this role's inline policy today.
- **Rollout and rollback.** AWS states the change rolls out region by region from 2027-04-26. Keeping the Log Stream statement ensures nothing breaks during rollout, as the issue says. Rollback is reverting the template.
- **Permission boundary.** `PermissionsBoundary` is optional on the role. An organization's boundary that allows only `arn:aws:logs:...:log-group:/aws/lambda/<prefix>-*:*` style resources would also need the Log Group form. This is invisible from the repository, so the changelog entry mentions it (G3).
- **Observability.** An `AccessDenied` on `CreateLogGroup` is only visible if the group is missing. The existing `WebServiceErrorsAlarm` would not catch it. This is acceptable because the group is template-managed.
- **Cost.** None.

## 5. Gaps and observations

- **G1. The issue does not say which actions are affected here.** It speaks generally. The plan narrows it to `CreateLogGroup` for this starter (C1, C2, C3).
- **G2. API Gateway `DestinationArn` uses the `:*` form.** `AccessLogSetting.DestinationArn` is not an IAM statement, so the AWS notice does not apply to it. The CloudFormation docs for `AWS::ApiGateway::Stage` `AccessLogSetting` accept the log group ARN from `GetAtt`. Classified as Note only, unless AWS says otherwise. Verification: after the first TEST deploy, confirm access logs still appear after the date AWS rolls out in the region.
- **G3. Permission boundaries and org SCPs are outside this repository.** A boundary that scopes `logs:` resources with `:*` would block the new `CreateLogGroup` grant. Cannot be checked here. Mention it in the changelog entry.
- **G4. The issue's "advise developers" requirement.** Resolved by Decision 4: the changelog entry is the only notice in this repository, so it must be self-contained (section 6, step 3).
- **G5. The issue says the MCP server can recommend updates.** That is a feature of `atlantis-mcp`, not this starter. This plan does not change MCP code, and the work is tracked in the separate issues.
- **G6. `CHANGELOG.md` intro says "Atlantis with Kiro AI assets".** It looks copied from another repository. Note only. The entry added by this work goes under `## v0.0.1 (unreleased)`, replacing the `TODO` placeholder per the changelog steering rules.
- **Affected tests and docs.** No test or doc currently encodes the old statement. Only `CHANGELOG.md` changes. No test files are added (Decision 3).

## 6. Proposed approach

All files are in this repository. Only two files change: `application-infrastructure/template.yml` and `CHANGELOG.md`.

1. **Edit `LambdaAccessToWriteLogs` in `application-infrastructure/template.yml`** (Decisions 1 and 2). Replace the single statement with two:
   - Stream actions on the existing Log Stream ARN (unchanged resource expression):
     ```yaml
     - Sid: LambdaAccessToWriteLogStreams
       Action:
       - logs:CreateLogStream
       - logs:PutLogEvents
       Effect: Allow
       Resource: !GetAtt WebServiceLogGroup.Arn # ends in :* (Log Stream ARN)
     ```
   - Log Group action on the plain Log Group ARN:
     ```yaml
     - Sid: LambdaAccessToCreateLogGroup
       Action:
       - logs:CreateLogGroup
       Effect: Allow
       Resource: !Sub 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WebServiceLogGroup}' # Ref returns the log group name
     ```
   The exact `Sid` values are an implementation detail. The original `LambdaAccessToWriteLogs` Sid goes away, which is not referenced elsewhere (grep finds it only at `template.yml:583`).
2. **Add a short comment** above the two statements explaining why there are two ARN forms: `GetAtt Arn` on `AWS::Logs::LogGroup` ends in `:*` and only authorizes the Log Stream actions, and Log Group actions need the plain Log Group ARN (AWS change effective 2027-04-26).
3. **Update `CHANGELOG.md`** under `## v0.0.1 (unreleased)` per the changelog steering file (run its version check first, and replace the `TODO` placeholder under `### Changed`). Decision 4 makes this the only notice, so the entry must be self-contained for someone who copied the starter: name the statement, say that `CreateLogGroup` moved to a Log Group ARN, say that the same change applies to any `Allow` statement with a Log Stream ARN (`:*` or `:log-stream:`) that lists non-stream actions, and say to check permission boundaries and SCPs that scope `logs:` resources. Do not add a release date or a version.
4. **Verify** (Decision 3, amended by Decision 6), without deploying and without AWS API calls:
   - `sam validate --lint -t application-infrastructure/template.yml` with SAM CLI 1.174.0 or later. SAM CLI 1.143.0 fails on the existing `nodejs24.x` runtime (`E3030`), unrelated to this change. The workstation CLI was updated to 1.174.0 on 2026-11-18 (user-level install in `~/.local`), and the lint passes on the unchanged Template.
   - Read the final statements against the AWS CloudWatch Logs identity-based policy examples 3a to 3c, and record in the `tasks.md` notes that the plain Log Group ARN grant for `CreateLogGroup` is documented but untested before deployment.
   - No policy simulation and no Access Analyzer check. The maintainer may run a simulation with a role that has the permission (optional check V5). If it denies `CreateLogGroup` on the plain Log Group ARN, reopen Q1 and fall back to keeping all three actions in both statements.

Alternatives considered:

- **Literal AWS recipe (second statement with all three actions, old statement untouched).** Rejected: leaves `CreateLogGroup` in a statement where it stops working.
- **`arn:aws:logs:*:*:*` or `log-group:*`.** Rejected for least privilege (4.1).
- **Remove `CreateLogGroup`.** Rejected: behavior change the issue does not ask for.
- **`${AWS::Partition}` or a repeated name pattern in the ARN.** Rejected for consistency with the rest of the file and to avoid duplicated name logic.
- **Spec-local jest test, `DEPLOYMENT.md` section, or reusable steering file.** Rejected as disproportionate for a two-statement change.

## 7. Related improvements

| Item | Class | Rationale | Effort | Risk |
|------|-------|-----------|--------|------|
| Changelog entry under v0.0.1 (unreleased) | Include | Required by the changelog steering file, and the only developer notice (Decision 4). Replaces the `TODO` placeholder. | S | Low |
| Snippets and audits for the other starters, `atlantis-sam-templates`, `atlantis-mcp`, and Kiro steering guidance | Out of scope | Issues already submitted by the maintainer (Decision 5). | n/a | n/a |
| CHANGELOG intro text mentions "Atlantis with Kiro AI assets" | Note only | Probably copied from another repository. | S | None |
| `DestinationArn` for API Gateway access logs uses a `:*` ARN | Note only | Not an IAM statement (G2). | none | Low |

## 8. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Dropping `CreateLogGroup` from the stream statement relies on the plain Log Group ARN already granting it today (C4), which is documented by AWS but untested before deployment (Decision 6). If that is wrong, `CreateLogGroup` is denied immediately, not only after April 2027. The impact is limited to recreating a deleted log group, since the template creates it. | Optional maintainer simulation (V5). If it denies, keep all three actions in both statements. |
| A permission boundary or SCP outside this repository scopes `logs:` resources with `:*` and blocks the new statement. | The changelog entry tells owners to check their boundary. Not testable here. |
| Sibling spec edits the same inline policy (the `OriginSecret` statement) and a merge conflict arises. | Both are already on `dev`. This change touches only the `LambdaAccessToWriteLogs` statement. |
| Developers who cloned the starter miss a changelog-only notice (Decision 4). Residual risk accepted by the maintainer. | Make the changelog entry self-contained, with the detection rule and the permission boundary caveat (section 6, step 3). |
| No automated test guards against reintroducing a `:*` ARN for a Log Group action (Decision 3). Residual risk accepted by the maintainer. | The changelog entry and the template comment document the rule. |

## 9. Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 (Q1) | Option B: split by resource type. `CreateLogStream` and `PutLogEvents` stay on the Log Stream ARN (`!GetAtt WebServiceLogGroup.Arn`). `CreateLogGroup` moves to its own statement on the plain Log Group ARN. | Each action sits under the ARN type it authorizes on, matching the Service Authorization Reference, and no dead grants remain after 2027-04-26. Depends on C4, which the simulation in section 6 confirms. If it fails, reopen. |
| 2 (Q2) | Option A: `!Sub 'arn:aws:logs:${AWS::Region}:${AWS::AccountId}:log-group:${WebServiceLogGroup}'`. | `Ref` returns the log group name, keeps the dependency, and the hard-coded partition matches the other ARNs in the file. |
| 3 (Q3) | Option A as chosen: `sam validate --lint` and no new test files. The `simulate-custom-policy` part is replaced by Decision 6. | The change is two statements. Residual risk: nothing automated prevents regression (section 8). |
| 4 (Q4) | Option A: `CHANGELOG.md` entry only. No `DEPLOYMENT.md` section and no new steering or skill file. | Maintainer choice. Residual risk: lower visibility for cloned-starter owners (section 8). The changelog entry is written to be self-contained to compensate. |
| 5 (Q4 spin-offs) | No spin-offs are created from this plan. Issues for the other starters, `serverless-cloudfront-cache-invalidation`, `atlantis-mcp`, `atlantis-sam-templates`, and steering guidance were already submitted by the maintainer. Scope is this repository only. | Maintainer statement, 2026-11-18. |
| 6 (Q3, amended 2026-11-18) | No pre-deployment policy simulation and no Access Analyzer check. Pre-deployment verification is lint plus a read of the statements against AWS documentation. The SAM CLI is updated so that `sam validate --lint` passes. | The workstation role lacks `iam:SimulateCustomPolicy`, and Access Analyzer custom policy checks are charged. Maintainer choice (option C). Residual risk: C4 is untested until deployed, see section 8. |

## 10. Open questions and recommendations

No open questions.
