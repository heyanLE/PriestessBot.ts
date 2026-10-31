# Task Agent workspace instructions

This file is the template for an Agent's instruction document. Copy it to the `configDirectory` of an
Agent that uses the `DEEPSEEK_HARNESS` preset:

```
mkdir -p agents/task-agent/config
cp docs/examples/AGENTS.md agents/task-agent/config/AGENTS.md
```

`agents/` is git-ignored, so the copy is per-deployment rather than checked in.

## What this document is for

It carries the rules that are specific to this deployment's work, so they do not have to be repeated in
the Agent's `instructions` field. The prompt tells the model that more specific instructions take
precedence over broader ones, and that this document does not override system, developer, or direct user
instructions.

## How it is loaded

- Read from the Agent's configuration directory on every request, so an edit takes effect on the next
  message with no restart.
- Only regular files are accepted: a symbolic link is ignored rather than followed.
- Identical documents are injected once.
- There is a byte budget (65536 by default). When it is exceeded the broadest documents are dropped first
  and the most specific one is truncated, and the model is told that happened.

## Rules that work well here

- State the commands that must be run before a change is considered done.
- Name the directories that must never be modified.
- Record the project's conventions — formatting, naming, test layout — rather than restating them in every
  Agent prompt.
- Keep it short. This text is paid for on every request.

<!-- Replace everything above this line with the real instructions for this deployment. -->
