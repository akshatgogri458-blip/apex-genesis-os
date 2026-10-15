# APEX Genesis OS

**Code available. Live application not yet deployed.**

APEX Genesis is an autonomous career-assistance application under development. This public repository currently contains the V9.1 source, including the job-research, candidate-matching, document, agent and Cloudflare Worker modules.

## Project state

- **Source:** published on `main`.
- **Automated checks:** clean npm install, native TypeScript for Node/Worker/Browser, lint/security scan, build, and supplied test suite succeeded on GitHub Actions at the Issue #1 merge.
- **Cloudflare:** remote Worker/D1 deployment and real inference are still **UNVERIFIED**.
- **External connections:** Gmail, Calendar and employer submissions still need real authorization and evidence.
- **Costs:** intended to stay on free tiers; no promise of unlimited processing or provider quotas.

**Next owner action:** [Follow the short Cloudflare account setup instructions](docs/NEXT_STEP_CLOUDFLARE.md).

**Engineering priority:** production deployments and real authorized integrations. Keep existing UI/3D visuals unchanged for now.

## Gemini handoff (different Google account)

This repository is public and readable by Gemini through its GitHub integration, but importing code in Gemini web does not itself give permission to push changes. Use an authorized GitHub writer or deliver a source archive for GitHub import. Every completion report must contain the actual remote branch, full 40-character commit SHA, clickable commit URL and GitHub Actions run.

## Safety

Never commit API keys, Google credentials, private candidate resumes, sessions, application records, or any other real personal data. This code and its test suite do not establish that real employer applications have been submitted.

Repository owner's original `V9` local SHA was `938ac19cd7a43fcdad3c3e3662a28c8b0808aea5`, but GitHub's imported source has independent commit history.
