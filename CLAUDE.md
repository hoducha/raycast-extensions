# Raycast Extensions Context

This repository contains extensions for the Raycast Store, specifically customized versions of `klog` and `todoist` integrations built with React and `@raycast/api`.

## Commands

Extensions are developed as independent Node packages located under the `extensions/` directory. **Run these commands from within a specific extension's directory** (e.g., `cd extensions/klog` or `cd extensions/todoist`), as there is no root-level `package.json`.

- **Development/Watch**: `npm run dev` (executes `ray develop`)
- **Build**: `npm run build` (executes `ray build -e dist`)
- **Lint**: `npm run lint` (executes `ray lint`)
- **Fix Lint Issues**: `npm run fix` (executes `ray lint --fix`)
- **Run All Tests**: `npm run test` (executes `vitest run`)
- **Run Tests in Watch Mode**: `npm run test:watch` (executes `vitest`)
- **Run Single Test**: `npx vitest <path/to/test.ts>`

## Architecture & Structure

This is a monorepo structure where each extension functions completely independently.

- **Technology Stack**: Extensions use React for UI components and standard Node.js for business logic, utilizing the `@raycast/api` for interacting with the Raycast environment (UI, storage, preferences).
- **Command Entry Points**: The top-level `.tsx` files in each extension's `src/` directory (e.g., `start-tracking.tsx`, `home.tsx`) correspond exactly to the commands defined in their respective `package.json` files.
- **Cross-Extension Integration**: Todoist integrates with Klog for time tracking. The `todoist/package.json` contains shared preferences like `klogPath`, `klogAvoidSilentCloseAfterHours`, and `klogSkipSessionsShorterThanMinutes` that govern how Todoist sessions interact with Klog's local `.klg` files.
- **Testing Methodology**: Unit tests are written using `vitest` in the `src/__tests__/` directory. The `@raycast/api` is mocked globally via alias resolution in `vitest.config.ts` (pointing to `src/__mocks__/@raycast/api.ts`).

### Extension Specifics
- **Klog (`extensions/klog`)**: Focused primarily on file-manipulation for time tracking. Logic is mostly encapsulated in `src/klog.ts` and UI commands.
- **Todoist (`extensions/todoist`)**: A more complex architecture utilizing `src/components/`, `src/hooks/`, `src/helpers/`, and `src/tools/` to manage multiple API endpoints, views, and complex state. External HTTP calls are typically handled in `src/api.ts`.
