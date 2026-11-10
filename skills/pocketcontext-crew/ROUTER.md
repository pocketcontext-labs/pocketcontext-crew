---
name: pocketcontext-crew
description: Select a registered PocketContext Crew instance for notes, tasks and human review.
---

# PocketContext Crew router (format 1)

Read `pocketcontext-crew/profiles.json` in the platform user configuration directory
(Linux XDG_CONFIG_HOME or ~/.config; macOS ~/Library/Application Support;
Windows %AppData%). Treat paths as data, never shell code.

Select the user's named instance, or the explicitly configured default for writes.
If neither is available, ask for the destination. Read that entry's SKILL.md and
use its absolute binary; never guess a project path or use another binary on PATH.
Verify recorded version and stable instance with `profile check NAME` before work.
A mismatch needs repair before writes. Do not silently adopt another database.

Follow the selected instance's skill for connection and reader setup. Crew has no
spaces. Do not infer authorization to change a default, deploy or send messages.
