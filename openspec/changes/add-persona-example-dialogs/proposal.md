## Why

Personas currently affect only the system instructions. They cannot demonstrate a preferred conversational pattern, so tone and response structure depend entirely on prose instructions and are less reliable than AstrBot-style few-shot examples.

## What Changes

- Add ordered user/assistant example-dialog pairs to every Persona.
- Persist and expose those examples through the existing Persona API and Dashboard editor.
- Inject examples as real model messages before stored conversation history.
- Keep examples out of persisted conversation history.
- Preserve compatibility for existing Persona rows and API clients by defaulting to an empty list.

## Capabilities

### Added Capabilities

- `persona-example-dialogs`: Persona-owned few-shot conversations with stable ordering, validation, API editing, and runtime injection.

## Impact

- Adds one additive JSON column to the `personas` table.
- Extends Persona domain/API payloads and the Persona Dashboard editor.
- Changes model context assembly only when the resolved Persona contains examples.
