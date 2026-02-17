# AI Agent Guidelines for Go OpenClaw Automation

This document serves as the **strict set of rules** for any AI Agent working on the `go-openclaw-automation` project.

## 1. Code Ownership & Learning Oriented
*   **Do NOT write code for the user** unless explicitly requested (i.e., user says "write this for me" or "implement this").
*   **Standard protocol**: Generate the solution code in the chat, explain the logic and the "why" behind it, and let the user type/implement it themselves. This is to ensure the user learns and understands the codebase.

## 2. Source of Truth
*   The **Node.js version** (located in the parent `execution/job-search.js` and related files) is the **Source of Truth**.
*   When extending or modifying this Go version, you **MUST** reference the Node.js implementation logic, flow, and intent. The user wants this Go version to closely mirror the Node.js version's capabilities.

## 3. Active Learning & Documentation
*   **#Todo: Comments**: When asked to explain a `#Todo:` comment:
    1.  Explain it briefly in the chat.
    2.  **Automatically** search for `LEARNING*.md` files in this directory.
    3.  Find a `LEARNING` file with **less than 500 lines**.
    4.  Append the **Question** (the Todo context) and the **Answer/Explanation** to that file.
    5.  If all existing `LEARNING` files are > 500 lines, **create a new one** (e.g., `LEARNING-04.md`).
    6. After finished, remove the `#Todo:` comment from the code.
    7. Before writing your code, you must evaluate and take notice of every repetetive / redundant code and refactor it into helper functions. Also apply every single Go's best practices when you're writing.

## 4. Git Push Protocol
*   When asked to push code:
    1.  Run `git commit -m "message"`.
    2.  Run `git push`.
    3.  **STOP**. Do **NOT** check the command status or verification.
    4.  Assume the user will verify the push themselves. The AI Agent's tools are not reliable enough to verify push status accurately in this environment.

## 5. Go Best Practices vs. Node.js MVP
*   While the Node.js version is the source of truth for **logic/intent**, it is considered an **MVP**.
*   The Go version is intended for **Production**.
*   **Override Rule**: If Go offers a better feature, architectural pattern, or performance optimization (e.g., concurrency models, type safety, better stdlib features) that is superior to the Node.js implementation, **you MUST use the Go Best Practice approach**.
*   Do not blindly copy "bad" patterns from Node.js if Go has a superior native alternative.

## 6. Execution Protocol
*   **ABSOLUTELY NO** automatic test execution or command running unless explicitly requested by the user.
*   Wait for the user to trigger run commands (e.g., `go test`, `go run`).
*   Only inspect output or provide fixes after the user has run the command.
