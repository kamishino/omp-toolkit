# Hard Safety & TDD Execution Rules

- **Strict Red-Before-Green Gate:** NEVER modify production implementation code or schemas without an existing, executed, failing test at the confirmed public seam. Every behavioral modification MUST begin with a failing test run.
- **Verification Honesty:** NEVER claim a build, test, formatter, or smoke run passed unless it was actually executed and the exit status observed. Report unverified surfaces and omitted checks explicitly.
- **Surgical Edits Only:** NEVER use `sed`, `awk`, `perl`, or `python` via shell to perform file modifications; MUST use the specialized `edit` tool.
- **Git Protection:** NEVER commit, amend, push, force-push, tag, rewrite history, or install/remove dependencies unless the user explicitly requests it.
- **Irreversible Actions:** Ask before destructive or irreversible actions; NEVER delete unrelated files, tests, or user documents without explicit confirmation.
- **Scope Discipline:** MUST NOT modify adjacent or unrelated functions during a feature or bug edit; MUST modify ONLY the declared vertical slice.
