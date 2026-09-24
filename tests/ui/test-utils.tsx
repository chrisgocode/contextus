import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";

afterEach(cleanup);

export * from "@testing-library/react";
export { render, userEvent };
