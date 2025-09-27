# Codex Alexa Skill

Command the Codex automation agent through Amazon Alexa. This package contains the
skill manifest and interaction model so it can be versioned, reviewed, and
published from source control.

## Project Layout

```
codelexa/
├── README.md
├── ask-resources.json
├── skill-package/
│   ├── skill.json                        # Alexa Manifest (metadata, endpoint, permissions)
│   └── interactionModels/
│       └── custom/en-US.json             # Invocation + intents
└── .ask/
    └── config                           # ASK CLI deployment config
```

No Lambda code is bundled because the skill forwards requests to the existing
Codex webhook running on `branch.bet`.

## Invocation & Intents

- Invocation name: `Codex`
- `RunTaskIntent` — captures any spoken task and forwards it to Codex
  (`AMAZON.SearchQuery` slot called `task`).
- `GetStatusIntent` — requests the latest status update from Codex.
- Built-in `AMAZON.HelpIntent`, `AMAZON.CancelIntent`, `AMAZON.StopIntent` are included.

## Endpoint Contract

`skill.json` points Alexa traffic at `https://branch.bet/alexa`. The handler
must:

1. Verify Amazon request signatures.
2. Parse `RunTaskIntent` by reading the `task` slot and enqueueing it for Codex.
3. Respond within 8 seconds with an acknowledgment speech/reprompt.
4. Issue a Proactive Events notification once Codex finishes the task.
5. Optionally service `GetStatusIntent` by reading the latest completion log.

## Notifications

The manifest requests the `alexa::devices:all:notifications:write` permission so
Codex can push completion alerts back to Alexa devices. Users must grant this
permission during skill enablement.

## Deployment with ASK CLI

1. Install prerequisites (already done on this box):
   ```bash
   npm install -g ask-cli
   ```
2. Configure ASK CLI credentials if not already set:
   ```bash
   ask configure
   ```
   Provide the Amazon developer account and select/enter an AWS profile for
   skill resources.
3. Deploy the skill package:
  ```bash
  cd ~/tools/codelexa
  ask deploy --target skill-metadata
  ```
  This uploads `skill-package/` and returns a `skill_id` that is persisted in `.ask/config`.
4. For future edits, update either the manifest or interaction model and redeploy
   with `ask deploy`.

## Open Source Notes

- Repo name suggestion: `codelexa`.
- License: MIT (feel free to replace with Apache-2.0 or another license before publishing).
- CI/CD: add linting or JSON schema validation as desired; ASK CLI can run in GitHub Actions using `ask smapi` commands.

## Next Steps

- Implement the HTTPS handler at `/alexa` with request verification and Codex integration.
- Configure Nginx on branch.bet to proxy `/alexa` to the internal service.
- Add proactive notification sender (Alexa Notifications API) to announce task completion.
- (Optional) Extend with additional locales, intents, or account linking for third-party access.

## Local Service (`server/`)

An Express server handles Alexa requests and forwards them to the existing
`codex-task-runner.py` pipeline. Run it locally with:

```bash
cd ~/tools/codelexa
npm install   # already done once
npm start
```

It listens on port `4090` (configurable via `CODELEXA_PORT`). Two handy routes
are provided:

- `POST /alexa` – Alexa webhook entry point.
- `GET /alexa/health` – simple health check (`{"status":"ok"}`).

The handler constructs a synthetic email envelope and streams it into
`~/bin/codex-task-runner.py`, so all task execution and email notifications reuse
the existing automation stack. Status intent responses read from
`~/.codex/task-mail-runner.log` to summarize the most recent completion.

Copy `.env.example` to `.env`, fill in the real skill credentials from the Alexa
developer console, and restart the process so `dotenv` can load them:

```
cd ~/tools/codelexa
cp .env.example .env
# edit .env with actual values
pm2 restart codelexa --update-env
pm2 save
```

Deploy it under `pm2` or `systemd` for persistence, then test end-to-end with
`ask simulate --text "ask Codex to <task>" --locale en-US` once the skill is
registered.
