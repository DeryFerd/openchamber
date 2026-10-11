import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { Window } from "happy-dom";

import { I18nProvider } from "@/lib/i18n";
import { GITHUB_SOURCE_CONTROL_IDENTITY } from "@/lib/source-control/identity";
import type { SourceControlAuthAccount } from "@/lib/source-control/types";
import { getSourceControlAuthKey, useSourceControlAuthStore } from "@/stores/useSourceControlAuthStore";
import type { SourceControlAuthStatus } from "@/lib/api/types";

import { GitHubSettings } from "./GitHubSettings";

// The card asks the registered runtime for its source-control API; the tests
// answer with a recording stub so the activation click can be observed.
const authActivateCalls: Array<[typeof GITHUB_SOURCE_CONTROL_IDENTITY, string]> = [];
const sourceControlMock = {
  authActivate: async (identity: typeof GITHUB_SOURCE_CONTROL_IDENTITY, accountId: string) => {
    authActivateCalls.push([identity, accountId]);
    return {
      ...GITHUB_SOURCE_CONTROL_IDENTITY,
      status: "connected" as const,
      connected: true as const,
      user: { ...GITHUB_SOURCE_CONTROL_IDENTITY, id: "9", username: "cli-user" },
      accounts: [],
      cli: { available: true, disabled: false, active: true },
    };
  },
};
mock.module("@/contexts/runtimeAPIRegistry", () => ({
  getRegisteredRuntimeAPIs: () => ({ sourceControl: sourceControlMock }),
}));

// Static rendering reads the store's server snapshot, which is its initial
// state, so the fixture is written onto that object rather than through
// setState. The key carries the runtime key, so it is computed per write.
const serverAuthState = useSourceControlAuthStore.getInitialState();

const setAuthEntry = (entry: {
  status: SourceControlAuthStatus | null;
  isLoading: boolean;
  hasChecked: boolean;
}) => {
  serverAuthState.entries[getSourceControlAuthKey(GITHUB_SOURCE_CONTROL_IDENTITY)] = entry;
};

const resetAuthState = () => {
  for (const key of Object.keys(serverAuthState.entries)) delete serverAuthState.entries[key];
};

const cliAccount: SourceControlAuthAccount = {
  id: "github.com#cli:9",
  credentialId: "github.com#cli:9",
  credentialRevision: 1,
  providerUserId: "github.com#9",
  providerUserStatus: "available",
  user: { ...GITHUB_SOURCE_CONTROL_IDENTITY, id: "9", username: "cli-user" },
  current: false,
  source: "cli",
  status: "valid",
};

const cliUser = { ...GITHUB_SOURCE_CONTROL_IDENTITY, id: "9", username: "cli-user" };

const cliOnlyStatus = (overrides?: { disabled?: boolean }): SourceControlAuthStatus => ({
  ...GITHUB_SOURCE_CONTROL_IDENTITY,
  status: "disconnected",
  connected: false,
  accounts: [cliAccount],
  cli: {
    available: true,
    disabled: overrides?.disabled ?? false,
    active: false,
    user: cliUser,
  },
});

const connectedCliStatus = (): SourceControlAuthStatus => ({
  ...GITHUB_SOURCE_CONTROL_IDENTITY,
  status: "connected",
  connected: true,
  user: cliUser,
  accounts: [{ ...cliAccount, current: true }],
  cli: { available: true, disabled: false, active: true, user: cliUser },
});

const renderSettings = () =>
  renderToStaticMarkup(
    <I18nProvider>
      <GitHubSettings />
    </I18nProvider>,
  );

describe("GitHubSettings", () => {
  beforeEach(resetAuthState);
  afterEach(resetAuthState);

  test("says it is checking during the initial auth status load", () => {
    setAuthEntry({ status: null, isLoading: true, hasChecked: false });

    expect(renderSettings()).toContain("Checking connection");
  });

  test("stays mounted while a checked status is refreshing, then shows reconnect state", () => {
    setAuthEntry({
      status: {
        ...GITHUB_SOURCE_CONTROL_IDENTITY,
        status: "connected",
        connected: true,
        user: { ...GITHUB_SOURCE_CONTROL_IDENTITY, id: "user-one", username: "octocat" },
        accounts: [{
          id: "account-one",
          credentialId: "account-one",
          credentialRevision: 1,
          providerUserId: "github.com#user-one",
          providerUserStatus: "available",
          user: { ...GITHUB_SOURCE_CONTROL_IDENTITY, id: "user-one", username: "octocat" },
          current: true,
          source: "oauth",
          status: "valid",
        }],
      },
      isLoading: true,
      hasChecked: true,
    });

    const refreshingMarkup = renderSettings();
    expect(refreshingMarkup).toContain("octocat");

    setAuthEntry({
      status: { ...GITHUB_SOURCE_CONTROL_IDENTITY, status: "disconnected", connected: false, accounts: [] },
      isLoading: false,
      hasChecked: true,
    });

    const disconnectedMarkup = renderSettings();
    expect(disconnectedMarkup).toContain("Not connected");
    expect(disconnectedMarkup).toContain("Connect GitHub");
  });

  test("offers the gh CLI account for activation when it is the only credential", () => {
    setAuthEntry({ status: cliOnlyStatus(), isLoading: false, hasChecked: true });

    expect(renderSettings()).toContain("Use this account");
  });

  test("does not offer gh CLI activation while the CLI account is disabled", () => {
    setAuthEntry({ status: cliOnlyStatus({ disabled: true }), isLoading: false, hasChecked: true });

    expect(renderSettings()).not.toContain("Use this account");
  });

  test("does not offer gh CLI activation once the CLI account is active", () => {
    setAuthEntry({ status: connectedCliStatus(), isLoading: false, hasChecked: true });

    expect(renderSettings()).not.toContain("Use this account");
  });
});

describe("GitHubSettings gh CLI activation", () => {
  let windowInstance: Window;
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    resetAuthState();
    authActivateCalls.length = 0;
    windowInstance = new Window({ url: "http://localhost/" });
    // SAFETY: the test installs a happy-dom Window for the component and restores the original global afterward.
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      navigator: windowInstance.navigator,
      Node: windowInstance.Node,
      Element: windowInstance.Element,
      HTMLElement: windowInstance.HTMLElement,
      Event: windowInstance.Event,
      MouseEvent: windowInstance.MouseEvent,
      MutationObserver: windowInstance.MutationObserver,
      getComputedStyle: windowInstance.getComputedStyle.bind(windowInstance),
      requestAnimationFrame: windowInstance.requestAnimationFrame.bind(windowInstance),
      cancelAnimationFrame: windowInstance.cancelAnimationFrame.bind(windowInstance),
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    windowInstance.close();
    resetAuthState();
  });

  test("activates the gh CLI account from the card", async () => {
    setAuthEntry({ status: cliOnlyStatus(), isLoading: false, hasChecked: true });

    await act(async () => {
      root.render(
        <I18nProvider>
          <GitHubSettings />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Use this account"));
    expect(button).toBeTruthy();

    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(authActivateCalls).toEqual([[GITHUB_SOURCE_CONTROL_IDENTITY, "github.com#cli:9"]]);
  });
});
