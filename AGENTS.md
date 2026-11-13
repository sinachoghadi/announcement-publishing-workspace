# Announcement Publishing Workspace

## Project overview

This Ganjeh frontend assignment builds a small workspace for a communications team. Users select one of three prepared announcements, read its content, submit it to the simulated publishing service, and follow its outcome. They can switch announcements while a publication is underway and recover existing operations after a refresh in the same browser tab.

Prioritize correct operation state, safe recovery, and clear feedback over visual complexity. The content is fixed and the supplied simulator provides all service behavior. The product scope is selecting, reading, publishing, and following prepared announcements.

## Source of truth

Apply this priority when deciding what to implement:

1. The official assignment [README](README.md).
2. The supplied TypeScript contracts.
3. The public mock service behavior.
4. Explicit requirements for the current implementation task.
5. Existing architectural decisions.

Identify and report conflicts explicitly. Preserve the official requirements and public contracts while resolving the conflict. Keep the official README intact and handle any relocation or candidate README as a separate task.

## Immutable mock files

The supplied files are `mocks/contracts.ts`, `mocks/fixtures.ts`, `mocks/index.ts`, and `mocks/service.ts`. Preserve their contents. Use only the public exports from `mocks/index.ts` for application integration, including public types.

- Keep mock service internals and test seams private to the supplied code.
- Never read or write mock-owned session storage directly.
- Never reimplement the simulator, add a replacement backend, or change the simulator to make tests pass.
- If the supplied mocks are missing, report the missing files and expect the original distribution in `mocks/`. Use the company-supplied files when they become available.

## Technology and architecture

- Use React functional components and hooks, strict TypeScript, modern ES modules, Vite, npm, and standard CSS.
- Use explicit types at meaningful boundaries. Avoid `any` unless its use has a documented reason.
- Keep modules small and cohesive. Separate business logic from presentation when the current task calls for both.
- Use clear, consistent names and follow existing project conventions.
- Handle asynchronous failures explicitly and associate results with the operation that produced them.
- Add abstractions, optimizations, and dependencies only when the task justifies them.
- Choose state management and status-refresh behavior when the relevant task is designed. The assignment allows manual checks, automatic updates, or a combination.

## Publishing domain invariants

These rules govern future publishing work. T01 only establishes the project foundation.

1. Every logical publication attempt has an operation ID.
2. Reusing an operation ID for the same announcement refers to the existing attempt.
3. A different operation ID creates a separate attempt.
4. An operation belongs to one specific announcement. Reusing its ID for another announcement produces an operation ID conflict.
5. Keep operation state independent of the current selection so users can switch announcements and follow multiple operations.
6. A network error can leave the outcome unconfirmed while publication continues. Preserve any confirmed result when a request fails.
7. A rejected operation is a confirmed terminal outcome. Show the service's reason.
8. A published operation is a confirmed terminal outcome.
9. Apply responses to the operation they describe. An older response must never overwrite a newer confirmed state.
10. Version 1 represents processing. Version 2 represents a terminal result.
11. A deliberate retry after confirmed rejection may create a new logical attempt. Reusing the rejected operation's ID returns its rejection.
12. Prevent unintended republication after a confirmed success.
13. After a refresh in the same tab, recover recorded operations through `listOperations()` and follow them through public status APIs without starting new operations.
14. A failed status check leaves the outcome unconfirmed unless a result is already known. Keep recovery available and reserve rejection for a confirmed service outcome.
15. When a publish response is lost, check the existing operation or safely repeat the request with its original ID. Never allocate a new ID solely because the response was lost.

## Required scenarios

Future publishing work must support all six supplied scenarios:

| Scenario | Expected behavior |
| --- | --- |
| `success` | An operation processes and the service confirms publication. |
| `explicit-rejection` | The service returns a terminal rejection with a reason. |
| `lost-response` | The initial publish response is lost while the operation continues. Recover the same attempt. |
| `status-check-failure` | The initial publish response is lost and the first status read for the operation temporarily fails. Either `getStatus()` or `listOperations()` can encounter the failure. |
| `overlapping` | Requests and operations for different announcements can finish in different orders. Each result must reach the correct announcement. |
| `slow-response` | Publication can finish before its initial response arrives. A delayed processing snapshot must never replace a confirmed result. |

Scenario controls are optional development utilities. Scenario changes affect new operations. Use the public operation methods as the source of publication truth.

## Out-of-scope features

- Authentication
- Real backend development
- Announcement creation, editing, or deletion
- Bulk publishing
- CMS functionality
- Public announcement website
- Advanced dashboards
- Deployment configuration unless explicitly requested

## Agent workflow

1. Read this file and the official README.
2. Inspect the existing implementation and relevant public mock exports before editing.
3. Identify the exact task ID, scope, and acceptance criteria.
4. Implement only the requested task.
5. Preserve unrelated code and files.
6. Preserve the supplied mocks and their public contracts.
7. Run relevant checks and verify behavior through the normal entry point.
8. Review the changes for scope creep.
9. Explain material technical decisions and trade-offs.
10. Report completed work and known limitations.

Start the next task only when explicitly requested. Report a check as passing only after executing it successfully.

With a supported Node.js version and npm available, run `npm ci` to install from the lockfile and `npm run dev` to start the application. Run `npm run lint` for ESLint, `npm run typecheck` for strict TypeScript checks, and `npm run build` for the production build. Use `npm run preview` to serve the built application locally.

## Task completion format

After each task, report:

- Task ID and summary
- Files created
- Files modified
- Technical decisions and trade-offs
- Commands executed
- Validation results
- Known issues or limitations
- Suggested Git commit message
- Next recommended task

## Git conventions

Keep commits focused and use Conventional Commits where appropriate. Examples include:

- `chore: initialize vite react typescript project`
- `chore: configure typescript and eslint`
- `feat: implement announcement publishing workflow`
- `fix: prevent stale publication responses`
- `test: cover publication recovery scenarios`

Keep secrets, generated build files, and unnecessary local artifacts out of version control. Track the npm lockfile for reproducible installs.

## Definition of done

- The requested functionality and task-specific acceptance criteria are met.
- All changes are within the requested scope.
- Strict TypeScript checks and existing relevant checks pass.
- The supplied mocks and contracts are intact.
- Relevant documentation reflects the implementation.
- Remaining issues and verification gaps are reported.

For future tasks, add behavior-specific acceptance criteria based on the task and the official README. For publishing changes, cover the applicable concurrency, recovery, and terminal-state behavior.
