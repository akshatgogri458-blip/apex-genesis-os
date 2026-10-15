# Using APEX Genesis with Gemini on a different Google account

This repository is **public**. Reading the source does **not** require the Google account used by ChatGPT to match the Google account used by Gemini.

## Reading the code in Gemini (web)

1. Open Gemini in the Google account used for your Gemini development session.
2. On desktop, use Gemini's **GitHub connected app / Import code** capability and authorize GitHub if prompted.
3. Select `akshatgogri458-blip/apex-genesis-os` from the repository picker and attach it to the conversation. A pasted URL alone does not necessarily import the repository.
4. Re-import or refresh when the remote branch changes: Gemini's repository snapshot is not automatically updated.

**Important limitation:** Google's Gemini web app's built-in GitHub integration is currently **read-only**. It can inspect source and suggest changes but **cannot write commits** to GitHub. See https://support.google.com/gemini/answer/16176929 .

## Publishing code changes

Choose a **write-capable** path:

- Preferred: Gemini delivers an actual complete changed-source ZIP, manifest and test logs; the repository owner then imports it using an authorized GitHub writer (such as the connected GitHub integration in ChatGPT, where supported) or GitHub's web editor.
- If the Gemini task runner has a real network-enabled Git CLI or GitHub API integration, authorize it with a GitHub account that has **write permission** on this repository. A different Google login is fine; GitHub permissions are attached to the authorized GitHub identity, not the Google login.
- If a second GitHub identity needs access, the owner can invite it under repository **Settings → Collaborators → Add people**. Only the repo owner should approve invitations. Do not give public write access to unknown users.

A source ZIP export and a local Git commit are **not proof** of a remote publication.

## Mandatory GitHub proof in every development report

```text
Repository URL: https://github.com/akshatgogri458-blip/apex-genesis-os
Branch: <actual remote branch>
Remote HEAD SHA: <actual full 40-character SHA>
Commit URL: https://github.com/akshatgogri458-blip/apex-genesis-os/commit/<actual full SHA>
Verification: PASS | GITHUB_PUSH_BLOCKED
```

Verify the URL, commit and files through GitHub after pushing. Never invent the commit URL. If publishing fails, return `GITHUB_PUSH_BLOCKED` plus the source artifact.

## Privacy and production controls

This public repository must contain **source code only**, never secrets, tokens, private candidate resumes, employer account cookies, OAuth grants, personal databases or real application records. No deployment or external submission should be inferred from the existence of GitHub source code.

## Current import state

The repository was initialized independently through the GitHub connector. The complete owner-provided V9 source ZIP is still pending import; do not call this a completed V9 source publication until source files and tests can be verified on the remote branch.
