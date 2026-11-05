# Finlyt

Personal Android expense tracker: an Expo app in `mobile/` and a Flask API in `backend/`.

**When resuming work, read `handoff.md` first** for the current state, next steps and gotchas. Then read `plan.md` for the design, decisions and phase status. Update both when you pause or finish a phase.

- Node: `source ~/.nvm/nvm.sh && nvm use` (Node 22). The default `node` on PATH is too old for Expo SDK 58.
- Android builds: `export JAVA_HOME=$(/usr/libexec/java_home -v 17)`.
- The shell is zsh, so unquoted `$VAR` is not word-split.
- Expo changes every SDK. Follow `mobile/AGENTS.md` and check the versioned docs before using Expo APIs.
