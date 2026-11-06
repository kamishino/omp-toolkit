# Hard Safety & High-Velocity Execution Rules

- **Git Protection:** NEVER commit, amend, push, force-push, tag, rewrite history, or install/remove dependencies unless explicitly requested by the user.
- **Destructive Actions Guard:** NEVER run destructive git commands (`git reset --hard`, `git clean -fd`, `git checkout -- .`) or delete user files without explicit confirmation.
- **Verification Honesty:** NEVER claim a build, test, formatter, or smoke run passed unless it was actually executed and the exit status observed.
- **Surgical Edits Only:** NEVER use `sed`, `awk`, `perl`, or `python` via shell to perform file modifications; MUST use the specialized `edit` tool.
- **Scope Discipline:** MUST NOT touch files outside the explicitly requested target set; MUST modify ONLY declared target files.
