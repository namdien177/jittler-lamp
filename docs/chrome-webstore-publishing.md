# Chrome Web Store publishing

The Release workflow uses GitHub OIDC to impersonate a dedicated Google service account. It requests an access token scoped to `https://www.googleapis.com/auth/chromewebstore` after downloading the extension ZIP.

## Security boundary

Only the reusable `publish-chrome.yml` workflow loaded from GitHub `main` can impersonate the service account. Before checking out code, it verifies a stable tag push in this repository and checks that its commit is the current `main` HEAD. Forks, pull requests, branches, and replacement publishing workflows on tags fail the trust condition or source check. Maintainers who can change `main` remain trusted. Protecting those accounts and reviewing workflow changes remain necessary.

Third-party release actions are pinned to full commit SHAs. Build jobs have read access; only GitHub release creation has repository write access. Checkout does not persist credentials. The publishing job runs no dependency installation and gets a 15-minute token only after artifact download. Google authentication masks its token output, writes no credential file, and exports no credentials to later steps. Only the publish step receives the access token, through its environment. The script uses Google's fixed HTTPS API origin, rejects redirects, limits request duration, and omits raw response bodies and transport errors from logs.

The token is not available to extension or desktop build jobs or artifact uploads. No refresh token or service account key is needed. The service account can manage this publisher's extensions, so publisher membership is also part of the trust boundary.

## Google Cloud configuration

- Project: `jittlelamp`, display name `JittleLamp`
- Project number: `660889243716`
- Service account: `chrome-webstore-publisher@jittlelamp.iam.gserviceaccount.com`
- Workload identity pool: `github-releases`
- Provider: `jittlelamp-release`
- Issuer: `https://token.actions.githubusercontent.com`
- Audience: the provider's default canonical resource name

Attribute mappings:

```text
google.subject = assertion.sub
attribute.repository_id = assertion.repository_id
```

Provider condition:

```text
assertion.repository_id == '1212426518' && assertion.repository_owner_id == '29449869' && assertion.sub == 'repo:namdien177/jittle-lamp:environment:production' && assertion.event_name == 'push' && assertion.ref.startsWith('refs/tags/v') && assertion.workflow_ref == 'namdien177/jittle-lamp/.github/workflows/release.yml@' + assertion.ref && assertion.job_workflow_ref == 'namdien177/jittle-lamp/.github/workflows/publish-chrome.yml@refs/heads/main'
```

The service account grants `roles/iam.workloadIdentityUser` to:

```text
principalSet://iam.googleapis.com/projects/660889243716/locations/global/workloadIdentityPools/github-releases/attribute.repository_id/1212426518
```

The project requires the Chrome Web Store, IAM, IAM Service Account Credentials, and Security Token Service APIs. The service account needs no project-wide role or downloaded key.

## GitHub production environment

Set `CHROME_SERVICE_ACCOUNT` to the service account email above and `CHROME_WORKLOAD_IDENTITY_PROVIDER` to:

```text
projects/660889243716/locations/global/workloadIdentityPools/github-releases/providers/jittlelamp-release
```

Keep `CHROME_PUBLISHER_ID` and `CHROME_EXTENSION_ID` as environment secrets. The workflow no longer reads `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, or `CHROME_REFRESH_TOKEN`.

## Publisher connection and verification

In the Chrome Web Store Developer Dashboard, open Settings, scroll to Management, and add the service account email under Service account. Google currently permits one service account per publisher.

After the workflow changes reach GitHub `main`, the next release tag must point at that same commit. The authentication step should produce an access token, followed by successful upload and submission. Google review and the selected publish type determine when the submitted version becomes public. Local tests validate the publishing configuration; they do not prove the live GitHub-to-Google token exchange.

References: [Google service account setup](https://developer.chrome.com/docs/webstore/service-accounts) and [GitHub authentication action](https://github.com/google-github-actions/auth).
