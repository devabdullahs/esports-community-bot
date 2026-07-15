import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { LoginPanelContent } from "@/components/dashboard/login-panel";
import { copy } from "@/lib/i18n";

describe("LoginPanelContent", () => {
  test("renders localized English and Arabic content with localized links", () => {
    const english = renderToStaticMarkup(<LoginPanelContent locale="en" />);
    const arabic = renderToStaticMarkup(<LoginPanelContent locale="ar" />);

    expect(english).toContain(copy.en.login.title);
    expect(english).toContain(copy.en.login.description);
    expect(english).toContain('href="/terms"');
    expect(english).toContain('href="/privacy"');
    expect(english).toContain('href="/"');
    expect(arabic).toContain(copy.ar.login.title);
    expect(arabic).toContain(copy.ar.login.description);
    expect(arabic).toContain('href="/ar/terms"');
    expect(arabic).toContain('href="/ar/privacy"');
    expect(arabic).toContain('href="/ar"');
  });

  test("renders the local mark, Discord action, and localized static states", () => {
    const defaultMarkup = renderToStaticMarkup(<LoginPanelContent locale="en" />);
    const pendingMarkup = renderToStaticMarkup(<LoginPanelContent locale="en" pending />);
    const errorMarkup = renderToStaticMarkup(
      <LoginPanelContent locale="ar" error={copy.ar.login.failedMessage} />,
    );

    expect(defaultMarkup).toContain('src="/icon.svg"');
    expect(defaultMarkup).toContain(copy.en.login.continue);
    expect(defaultMarkup).toContain(copy.en.login.trust);
    expect(defaultMarkup).not.toContain("Secure community access");
    expect(pendingMarkup).toContain("disabled");
    expect(pendingMarkup).toContain('aria-busy="true"');
    expect(pendingMarkup).toContain(copy.en.login.pending);
    expect(errorMarkup).toContain(copy.ar.login.failedTitle);
  });

  test("keeps the secondary action as a mirrored anchor without a duplicate brand strip", () => {
    const markup = renderToStaticMarkup(<LoginPanelContent locale="en" />);

    expect(markup).toContain(`href="/">${copy.en.login.browse}`);
    expect(markup).toContain("rtl:rotate-180");
    expect(markup.match(/href="\//g)).toHaveLength(3);
  });
});
