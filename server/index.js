#!/usr/bin/env node
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const Alexa = require('ask-sdk-core');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendCompletionNotice } = require('./notifier');

const RUNNER_PATH = '/home/branchmanager/bin/codex-task-runner.py';
const LOG_PATH = path.join(process.env.HOME || '/home/branchmanager', '.codex', 'task-mail-runner.log');
const PORT = process.env.CODELEXA_PORT || 4090;

function enqueueTask(taskText) {
  const messageId = `alexa-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = [
    'From: Codex Alexa <alexa@branch.bet>',
    'To: tasks@branch.bet',
    'Reply-To: branch@branch.bet',
    `Subject: Voice task - ${new Date().toISOString()}`,
    `Message-ID: <${messageId}@branch.bet>`,
    '',
    taskText,
    ''
  ].join('\n');

  const proc = spawn('python3', [RUNNER_PATH], {
    stdio: ['pipe', 'ignore', 'ignore'],
    env: process.env
  });

  proc.stdin.write(email);
  proc.stdin.end();
  proc.on('close', (code) => {
    if (code !== 0) {
      console.error(`[codelexa] Runner exited with code ${code}`);
      return;
    }
    sendCompletionNotice(`Codex finished: ${taskText}`);
  });
}

function readLatestStatus() {
  try {
    const data = fs.readFileSync(LOG_PATH, 'utf-8');
    const lines = data.trim().split(/\r?\n/).reverse();
    for (const line of lines) {
      if (line.includes('Sent response to')) {
        return line.replace(/^\[[^\]]+\]\s*/, '');
      }
    }
    return null;
  } catch (err) {
    console.error('[codelexa] Failed to read status log', err.message);
    return null;
  }
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

    enqueueTask(taskSlot);

    const speakOutput = `Got it. I'll let you know when Codex finishes.`;
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
    const latest = readLatestStatus();
    if (!latest) {
      return handlerInput.responseBuilder
        .speak('I do not have any recent updates yet.')
        .withShouldEndSession(true)
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak(latest)
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
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`[codelexa] Alexa endpoint listening on port ${PORT}`);
});
