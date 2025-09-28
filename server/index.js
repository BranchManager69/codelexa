#!/usr/bin/env node
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { sendCompletionNotice } = require('./notifier');
const { verifyAlexaRequest } = require('./signatureVerifier');
const pkg = require('../package.json');

const RUNNER_PATH = '/home/branchmanager/bin/codex-task-runner.py';
const STATUS_PATH = path.join(process.env.HOME || '/home/branchmanager', '.codex', 'codelexa-status.json');
const PORT = process.env.CODELEXA_PORT || 4090;
const APP_VERSION = pkg.version || '0.0.0';

const SMOKE_TEST_PROMPT = `Run the full smoke test suite across all deployed services (dexter API/FE, branch.bet, pumpstreams, fantasy, redis, etc.).
Report service health, failing checks, and remediation actions. Keep the final summary under 450 characters and highlight any failures.`;

const INBOX_SUMMARY_PROMPT = `Summarize today's messages for branch@branch.bet.
Include count of new emails, highlight high-priority alerts, financial notices, and GitHub advisories. Mention items that need follow-up.
Return a concise summary under 400 characters suitable for speech.`;

const POWER_RANKINGS_PROMPT = `Generate the latest fantasy football power rankings for the league.
Rank teams with brief rationale, note key matchups, and email the full write-up to branch@branch.bet with subject "Fantasy Power Rankings".
Return a spoken summary under 450 characters listing the top contenders.`;

function loadStatusEntries() {
  try {
    const raw = fs.readFileSync(STATUS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function recordStatusEntry(entry) {
  try {
    const entries = loadStatusEntries();
    entries.unshift(entry);
    if (entries.length > 25) {
      entries.length = 25;
    }
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error('[codelexa] Failed to record status entry', err.message);
  }
}

function latestStatusEntry() {
  const entries = loadStatusEntries();
  return entries.length ? entries[0] : null;
}

function buildRunnerStatus() {
  const info = {
    path: RUNNER_PATH,
    exists: false,
    executable: false,
    size: null,
    mtime: null
  };

  try {
    const stats = fs.statSync(RUNNER_PATH);
    info.exists = true;
    info.size = stats.size;
    info.mtime = stats.mtime.toISOString();
    try {
      fs.accessSync(RUNNER_PATH, fs.constants.X_OK);
      info.executable = true;
    } catch (err) {
      info.executable = false;
    }
  } catch (err) {
    info.exists = false;
  }

  return info;
}

function buildNotificationStatus() {
  const requiredKeys = ['ALEXA_SKILL_ID', 'ALEXA_CLIENT_ID', 'ALEXA_CLIENT_SECRET'];
  const missing = requiredKeys.filter(key => !process.env[key]);

  return {
    configured: missing.length === 0,
    missing
  };
}

function buildHealthReport() {
  const now = new Date();
  const entries = loadStatusEntries();
  const runner = buildRunnerStatus();
  const notifications = buildNotificationStatus();
  const latest = entries.length ? entries[0] : null;

  const issues = [];
  if (!runner.exists) {
    issues.push('runner_missing');
  } else if (!runner.executable) {
    issues.push('runner_not_executable');
  }
  if (!notifications.configured) {
    issues.push('notifications_unconfigured');
  }

  const status = issues.length === 0 ? 'ok' : (runner.exists || notifications.configured ? 'degraded' : 'error');

  const latestTimestamp = latest?.timestamp ? new Date(latest.timestamp) : null;
  const latestAgeSeconds = latestTimestamp ? Math.max(0, Math.round((now - latestTimestamp) / 1000)) : null;

  return {
    service: 'codelexa',
    status,
    issues,
    version: APP_VERSION,
    timestamp: now.toISOString(),
    uptime_seconds: Math.round(process.uptime()),
    port: Number(PORT),
    node_env: process.env.NODE_ENV || null,
    runner,
    notifications,
    history_count: entries.length,
    recent_tasks: entries.slice(0, 5).map(entry => ({
      timestamp: entry.timestamp,
      task: entry.task,
      status: entry.status,
      summary: entry.summary,
      intent: entry.intent,
      recipient_count: Array.isArray(entry.recipients) ? entry.recipients.length : 0
    })),
    latest_task: latest ? {
      timestamp: latest.timestamp,
      age_seconds: latestAgeSeconds,
      status: latest.status,
      summary: latest.summary,
      task: latest.task,
      intent: latest.intent
    } : null
  };
}

function enqueueTask(taskText, { accessToken = null, intent = 'RunTaskIntent' } = {}) {
  const messageId = `alexa-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const contextLines = [`INTENT=${intent}`];
  if (accessToken) {
    contextLines.push(`ACCESS_TOKEN=${accessToken}`);
  }
  const contextBlock = contextLines.length ? `[[CONTEXT]]\n${contextLines.join('\n')}\n[[/CONTEXT]]\n\n` : '';
  const email = [
    'From: Codex Alexa <alexa@branch.bet>',
    'To: tasks@branch.bet',
    'Reply-To: branch@branch.bet',
    `Subject: Voice task - ${new Date().toISOString()}`,
    `Message-ID: <${messageId}@branch.bet>`,
    '',
    `${contextBlock}${taskText}`,
    ''
  ].join('\n');

  const proc = spawn('python3', [RUNNER_PATH], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CODELEXA_ACCESS_TOKEN: accessToken || ''
    }
  });

  let stdout = '';
  let stderr = '';

  if (proc.stdout) {
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
  }
  if (proc.stderr) {
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
  }

  proc.stdin.write(email);
  proc.stdin.end();
  proc.on('close', (code) => {
    const resultTimestamp = new Date().toISOString();
    let notificationText = `Codex finished: ${taskText}`;
    let summary = '';
    let status = code === 0 ? 'success' : 'error';
    let session = null;
    let recipients = [];

    if (stdout.trim()) {
      try {
        const lines = stdout.trim().split('\n');
        const parsed = JSON.parse(lines[lines.length - 1]);
        summary = parsed.summary || summary;
        status = parsed.status || status;
        session = parsed.session || session;
        recipients = parsed.recipients || recipients;
        if (summary) {
          notificationText = summary;
        }
      } catch (err) {
        console.error('[codelexa] Failed to parse runner output', err.message);
      }
    }

    if (code !== 0 && stderr.trim()) {
      summary = summary || stderr.trim();
      notificationText = `Codex encountered an error: ${summary}`;
    }

recordStatusEntry({
  timestamp: resultTimestamp,
  task: taskText,
  status,
  summary,
  session,
  recipients,
  intent
});

sendCompletionNotice(notificationText);

if (code !== 0) {
  console.error(`[codelexa] Runner exited with code ${code}`);
}
  });
}

function extractAccessToken(handlerInput) {
  return handlerInput?.requestEnvelope?.context?.System?.user?.accessToken || null;
}

const LaunchRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  },
  handle(handlerInput) {
    const speakOutput = 'Codex is ready. Tell me what you need.';
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt('What task should Codex handle?')
      .getResponse();
  }
};

const RunTaskIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RunTaskIntent';
  },
  handle(handlerInput) {
    const taskSlot = Alexa.getSlotValue(handlerInput.requestEnvelope, 'task');
    if (!taskSlot) {
      const speakOutput = 'I did not catch the task. Please say it again.';
      return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt('What task should Codex handle?')
        .getResponse();
    }

    const accessToken = extractAccessToken(handlerInput);
    enqueueTask(taskSlot, { accessToken, intent: 'RunTaskIntent' });

    const speakOutput = `Got it. I'll let you know when Codex finishes.`;
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(true)
      .getResponse();
  }
};

const RunSmokeTestsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'RunSmokeTestsIntent';
  },
  handle(handlerInput) {
    const accessToken = extractAccessToken(handlerInput);
    enqueueTask(SMOKE_TEST_PROMPT, { accessToken, intent: 'RunSmokeTestsIntent' });
    const speakOutput = 'Starting the smoke tests. I will report the results when Codex finishes.';
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(true)
      .getResponse();
  }
};

const SummarizeInboxIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'SummarizeInboxIntent';
  },
  handle(handlerInput) {
    const accessToken = extractAccessToken(handlerInput);
    enqueueTask(INBOX_SUMMARY_PROMPT, { accessToken, intent: 'SummarizeInboxIntent' });
    const speakOutput = 'Gathering today’s inbox summary. I will let you know once Codex finishes.';
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(true)
      .getResponse();
  }
};

const EmailPowerRankingsIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'EmailPowerRankingsIntent';
  },
  handle(handlerInput) {
    const accessToken = extractAccessToken(handlerInput);
    enqueueTask(POWER_RANKINGS_PROMPT, { accessToken, intent: 'EmailPowerRankingsIntent' });
    const speakOutput = 'Generating the fantasy power rankings and emailing the write-up. I will notify you when it is complete.';
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(true)
      .getResponse();
  }
};

const GetStatusIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'GetStatusIntent';
  },
  handle(handlerInput) {
    const entry = latestStatusEntry();
    if (!entry) {
      return handlerInput.responseBuilder
        .speak('I do not have any recent updates yet.')
        .withShouldEndSession(true)
        .getResponse();
    }

    const when = entry.timestamp ? new Date(entry.timestamp).toLocaleString('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit'
    }) : 'recently';
    const task = entry.task || 'the last task';
    const summary = entry.summary || (entry.status === 'success' ? 'Completed successfully.' : 'Finished with an error.');
    const speakOutput = `Most recent task on ${when}: ${task}. Result: ${summary}`;

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .withShouldEndSession(true)
      .getResponse();
  }
};

const HelpIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
  },
  handle(handlerInput) {
    const speakOutput = 'Ask Codex to handle a task, for example, "run the nightly deployment".';
    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt('What task do you want Codex to run?')
      .getResponse();
  }
};

const CancelAndStopIntentHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
      && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
        || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder
      .speak('Goodbye.')
      .withShouldEndSession(true)
      .getResponse();
  }
};

const SessionEndedRequestHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(handlerInput) {
    return handlerInput.responseBuilder.getResponse();
  }
};

const IntentReflectorHandler = {
  canHandle(handlerInput) {
    return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
  },
  handle(handlerInput) {
    const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
    const speakOutput = `You just triggered ${intentName}.`;

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .getResponse();
  }
};

const ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(handlerInput, error) {
    console.error(`[codelexa] Error handled: ${error.message}`);
    const speakOutput = 'Sorry, I had trouble doing that. Please try again.';

    return handlerInput.responseBuilder
      .speak(speakOutput)
      .reprompt('Please try again.')
      .getResponse();
  }
};

const skillBuilder = Alexa.SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    RunTaskIntentHandler,
    RunSmokeTestsIntentHandler,
    SummarizeInboxIntentHandler,
    EmailPowerRankingsIntentHandler,
    GetStatusIntentHandler,
    HelpIntentHandler,
    CancelAndStopIntentHandler,
    SessionEndedRequestHandler,
    IntentReflectorHandler
  )
  .addErrorHandlers(ErrorHandler);

const app = express();
app.use(bodyParser.json({
  type: 'application/json',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf8');
  }
}));

const adapter = new ExpressAdapter(skillBuilder.create(), true, true);
app.post('/alexa', verifyAlexaRequest, adapter.getRequestHandlers());

app.get('/alexa/health', (req, res) => {
  try {
    res.json(buildHealthReport());
  } catch (err) {
    console.error('[codelexa] Failed to build health report', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[codelexa] Alexa endpoint listening on port ${PORT}`);
});
