import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Test files share a worker (isolate: false), so drop source modules cached
// under another file's vi.mock and any storage it left behind.
vi.resetModules();
localStorage.clear();
sessionStorage.clear();

afterEach(cleanup);
