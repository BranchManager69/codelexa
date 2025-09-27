<div align="center">

# Codelexa

_Voice-control your Codex automation agent through Amazon Alexa with resumable requests, proactive notifications, and Codex-integrated status updates._

[![shell](https://img.shields.io/badge/shell-bash-4EAA25.svg)](#install--first-run)
[![node](https://img.shields.io/badge/node-18%2B-339933.svg)](#requirements)
[![ask-cli](https://img.shields.io/badge/tool-ASK%20CLI-512BD4.svg)](#install--first-run)
[![license](https://img.shields.io/github/license/BranchManager69/codelexa.svg?color=blue)](#license)

</div>

---

## Quick Navigation
- [Why Codelexa](#why-codelexa)
- [Requirements](#requirements)
- [Install & First Run](#install--first-run)
- [How It Works](#how-it-works)
- [Skill Layout](#skill-layout)
- [Workflows](#workflows)
- [Configuration Cheat Sheet](#configuration-cheat-sheet)
- [Data & Security](#data--security)
- [Troubleshooting & FAQ](#troubleshooting--faq)
- [Local Service](#local-service)
- [Roadmap](#roadmap)
- [License](#license)

## Why Codelexa
Codelexa packages an Alexa custom skill that forwards spoken commands to the existing Codex automation agent. It gives you:
- **Hands-free tasking** – say “Alexa, ask Codex to ship the backend” and the request is enqueued via your Codex webhook.
- **Institutional memory** – intents include status polling, smoke test triggers, fantasy league power rankings, and more.
- **Proactive notifications** – push updates back to Alexa devices when Codex finishes, so you hear the result instantly.

## Requirements
- Node.js 18+
- npm (ships with Node)
- Amazon Developer account with [ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/ask-cli-intro.html) credentials configured
- Existing Codex webhook endpoint (default `https://branch.bet/alexa`)
- Optional: PM2 or systemd for process supervision

## Install & First Run
1. **Clone & bootstrap**
   ```bash
   git clone https://github.com/BranchManager69/codelexa.git ~/tools/codelexa
   cd ~/tools/codelexa
   npm install
   ```

2. **Configure ASK CLI** *(one-time if not already done)*
   ```bash
   ask configure
   ```

3. **Deploy skill metadata**
   ```bash
   npm run deploy
   ```
   This uploads `skill-package/`, persists the returned `skillId` in `.ask/config`,
   and restarts the pm2 service so the latest intents are active.

4. **Run the local webhook service**
   ```bash
   npm start
   ```
   By default it listens on port `4090` and proxies requests to your Codex runner.

5. **PM2 supervision (optional)**
   ```bash
   pm2 start ecosystem.config.js   # if you add one
   pm2 save
   ```

## How It Works
```mermaid
flowchart LR
    A[Alexa device] -->|invokes| B[Codelexa Skill]
    B -->|HTTPS POST| C[/alexa endpoint]
    C -->|verifies signature| D{Codex task runner}
    D -->|queues task| E[Codex CLI / automation pipeline]
    E -->|updates| F[status log & proactive notifications]
    F -->|notify| A
```

- The Alexa skill (manifest + interaction model) lives under `skill-package/`.
- The Express server (`server/`) verifies Amazon signatures, translates intents into Codex tasks, and streams responses back.
- When Codex finishes, the service triggers Alexa Notifications so devices announce the completion.

## Skill Layout
```
codelexa/
├── README.md
├── ask-resources.json
├── skill-package/
│   ├── skill.json                        # Alexa manifest (endpoint, permissions)
│   └── interactionModels/custom/en-US.json
└── .ask/
    └── config                            # ASK CLI deployment settings
```

## Workflows
### 1. Resume a Codex session hands-free
- Say: “Alexa, ask Codex to resume the wallet payout run.”
- `RunTaskIntent` captures the `task` query and forwards it to Codex.
- Codex executes, emails the result, and the skill pushes a proactive notification.

### 2. Run smoke tests on demand
- Say: “Alexa, tell Codex to run smoke tests.”
- `RunSmokeTestsIntent` triggers the automation runner; the voice response summarizes success/failure.

### 3. Check status
- Say: “Alexa, ask Codex for status.”
- `GetStatusIntent` reads the latest entry from `~/.codex/codelexa-status.json` and replies with a formatted summary.

### 4. Deploy new intents & models
- Edit `skill-package/interactionModels/custom/en-US.json`.
- Run `ask deploy --target interaction-model`.
- Update the Express handler if the intent shape changes.

## Configuration Cheat Sheet
| Setting | Default | Purpose | Change when |
| --- | --- | --- | --- |
| `CODELEXA_PORT` | `4090` | Local Express listener | Running behind a different proxy |
| `CODELEXA_ENDPOINT` | `https://branch.bet/alexa` | External HTTPS endpoint | Hosting elsewhere |
| `CODELEXA_STATUS_LOG` | `~/.codex/codelexa-status.json` | Stores voice + Codex summary pairs | Use custom log location |
| `CODELEXA_WEBHOOK` | `~/bin/codex-task-runner.py` | CLI invoked for tasks | Hook into alternate runner |
| `ASK_PROFILE` | default ASK profile | Deploy target | Managing multiple skill profiles |
| `ASK_REFRESH_TOKEN` | from `ask configure` | Auth for deployments | Rotating tokens |

## Data & Security
- Verify signatures using Amazon’s certificate chain before accepting any Alexa traffic.
- HTTPS endpoint must be publicly reachable with a valid certificate.
- The skill requests `alexa::devices:all:notifications:write` permission for proactive events—users grant this during enablement.
- No transcripts are stored beyond the status log; redact or rotate as needed.

## Troubleshooting & FAQ
- **`ask deploy` fails with auth error:** re-run `ask configure` or refresh tokens via `ask util regenerate-lwa-tokens`.
- **Alexa reports invalid signature:** ensure you forward the raw request body (Express `bodyParser` with `verify` hook) before verification.
- **No proactive notifications:** confirm users granted permissions; send using Amazon’s Notifications API with the correct `skillId` and `eventName`.
- **Lambda vs webhook?** We rely on the webhook to reuse the existing Codex pipeline; swap to Lambda if you want to host in AWS.

## Local Service
`server/` contains the Express bridge. Key routes:
- `POST /alexa` – main skill handler. Verifies signature, dispatches intents, streams updates to Codex runner.
- `GET /alexa/health` – returns `{ "status": "ok" }` for PM2/nginx health checks.

Copy `.env.example` to `.env`, set credentials, then restart the service:
```bash
cp .env.example .env
# populate ASK + Codex secrets
pm2 restart codelexa --update-env
pm2 save
```

## Roadmap
- Add account linking for multi-user access.
- Expand locale coverage beyond `en-US`.
- Include automated ASK schema validation in CI.
- Deliver templated proactive announcements (e.g., with summary bullet points).

## License
MIT. PRs welcome—open an issue if you want to layer in new intents, locales, or handler integrations.
