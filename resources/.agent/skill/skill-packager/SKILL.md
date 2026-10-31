---
name: skill-packager
description: Create or update a reusable PriestessBot skill from a working procedure. Use for skill packaging and maintenance, not for a one-time task.
---

# Package a skill

Use the skill tools to install instructions that later tasks can find.
The runtime stores each skill at `.agent/skill/<name>/` in its selected area.
The tools add `.agent/skill/` to the path. Do not add that prefix yourself.

## Choose an area

- Use `libraryId: "isolated"` for work that belongs to this conversation.
- Use `libraryId: "shared"` when the user wants other conversations to use the skill.
- Only an elite operator can change shared skills. The runtime checks this permission.
- Do not put credentials, private conversation records, or user-specific files in a shared skill.

Call `list_skills` first. Use `read_skill` to inspect an existing skill before you change it.
Use the exact library ID and path from the list. Existing configured libraries are read-only.
Do not change the runtime state or bypass a denied tool call.

## Write the package

Choose a short name with lowercase letters, digits, and hyphens.
Use the same name for the folder and the YAML `name` field.
Write `<name>/SKILL.md` with `write_skill`. Start with this structure:

```markdown
---
name: example-skill
description: Describe the task this skill handles and when to use it.
---

# Example skill

State the expected result. Give the steps that need project-specific knowledge.
State the checks that show success. State what to do when a required step fails.
```

Keep instructions short. Give one action per sentence. Use the same term for the same thing.
State exact tool arguments when their format matters. Do not add permissions the user did not grant.
Include only resources that the procedure needs:

- `references/`: details to read when a specific step needs them.
- `scripts/`: code that makes a repeated operation reliable.
- `assets/`: files that belong in the generated result.

Paths are relative to the skill area. For example, use `example-skill/references/schema.md`.
Use `overwrite: false` for new files. To replace a file, read it first and then use `overwrite: true`.
Use `delete_skill_file` only for a file that the requested change makes unnecessary.
There is no recursive directory deletion. Delete each intended file by its exact path.

## Check the result

Read each changed file with `read_skill`. Call `list_skills` and confirm that the entry appears.
For scripts, check the selected execution environment and its available commands first.
Do not assume that `python`, Pillow, NumPy, or PyYAML is installed.
Use `python3` when it is available. Put extra Python packages in a workspace virtual environment.
Do not use global `pip install` to bypass a managed Python environment.
The default command shell is `/bin/sh`. Do not assume Bash expansion.
Run a small test with synthetic data when the current permissions allow script execution.
If execution is denied or a dependency is missing, report that limit. Do not claim that the script passed.

Report the installed library ID, skill path, and checks that passed.
