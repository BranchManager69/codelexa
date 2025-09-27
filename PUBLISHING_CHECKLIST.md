# Codex Skill – Publishing Checklist

Use this as a blueprint when preparing the Codex Alexa skill for public release.

## 1. Feature Completion
- [ ] Account linking powered by Dexter OAuth (authorization + token endpoints).
- [ ] All intents wired to respect the linked user (use access token in Codex prompts).
- [ ] Notifications tested end-to-end for linked accounts.

## 2. Policies & Legal
- [ ] Privacy Policy URL published and linked in the Distribution tab.
- [ ] Terms of Use URL published and linked in the Distribution tab.
- [ ] Answer skill data usage questions accurately once account linking is active.

## 3. Distribution Metadata
- [ ] On the Distribution tab: set availability to **Public**.
- [ ] Provide short/long descriptions, example phrases, keywords, and categories.
- [ ] Upload 108x108 and 512x512 icons meeting Alexa requirements.
- [ ] Provide detailed testing instructions for certification reviewers.
- [ ] Supply test credentials (username/password) for account linking.

## 4. Technical Hardening
- [ ] Alexa request signature verification (already implemented).
- [ ] Structured summaries capped under 8000 characters for speech.
- [ ] Localized responses if you plan to support additional locales.
- [ ] QA all intents on physical Alexa devices using publication-ready endpoints.

## 5. Submission Process
- [ ] Run `npm run deploy` to ensure the skill metadata matches production.
- [ ] Enable the skill in Test mode on your account and complete regression tests.
- [ ] Submit the skill via the Alexa developer console.
- [ ] Monitor certification feedback and iterate on any required changes.

Keep this checklist versioned with the repo so future releases follow the same workflow.
