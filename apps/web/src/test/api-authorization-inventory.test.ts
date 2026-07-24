import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import {
  API_AUTHORIZATION_POLICY,
  HTTP_METHODS,
  authorizationPolicyKey,
  type HttpMethod,
} from "./api-authorization-policy";

const API_ROOT = fileURLToPath(new URL("../app/api", import.meta.url));
const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS);

type DiscoveredMethod = {
  route: string;
  method: HttpMethod;
  sourcePath: string;
  source: string;
};

function routeFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(absolute);
    return entry.name === "route.ts" ? [absolute] : [];
  });
}

function exported(node: ts.Node): boolean {
  return Boolean(ts.getModifiers(node as ts.HasModifiers)?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  ));
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function discoverMethods(): DiscoveredMethod[] {
  return routeFiles(API_ROOT).flatMap((sourcePath) => {
    const source = fs.readFileSync(sourcePath, "utf8");
    const sourceFile = ts.createSourceFile(
      sourcePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const methods = new Set<HttpMethod>();

    for (const statement of sourceFile.statements) {
      if (ts.isFunctionDeclaration(statement) && exported(statement) && statement.name) {
        if (HTTP_METHOD_SET.has(statement.name.text)) {
          methods.add(statement.name.text as HttpMethod);
        }
        continue;
      }
      if (ts.isVariableStatement(statement) && exported(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const name of bindingNames(declaration.name)) {
            if (HTTP_METHOD_SET.has(name)) methods.add(name as HttpMethod);
          }
        }
        continue;
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause
          && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (HTTP_METHOD_SET.has(element.name.text)) {
            methods.add(element.name.text as HttpMethod);
          }
        }
      }
    }

    const route = path.relative(API_ROOT, path.dirname(sourcePath)).split(path.sep).join("/");
    return [...methods].map((method) => ({ route, method, sourcePath, source }));
  });
}

describe("API authorization policy inventory", () => {
  const discovered = discoverMethods();
  const discoveredByKey = new Map(
    discovered.map((entry) => [authorizationPolicyKey(entry.route, entry.method), entry]),
  );
  const policyByKey = new Map(
    API_AUTHORIZATION_POLICY.map((entry) => [
      authorizationPolicyKey(entry.route, entry.method),
      entry,
    ]),
  );

  test("classifies every exported route method with no stale entries", () => {
    expect(discovered.length).toBeGreaterThan(100);
    expect([...policyByKey.keys()].sort()).toEqual([...discoveredByKey.keys()].sort());
  });

  test("keeps every policy relationship explicit", () => {
    for (const entry of API_AUTHORIZATION_POLICY) {
      expect(entry.relationship.trim(), authorizationPolicyKey(entry.route, entry.method))
        .not.toBe("");
    }
  });

  test("requires an executable denial fixture for every protected method", () => {
    const unprotected = new Set(["public", "framework-auth", "public-mcp"]);
    for (const entry of API_AUTHORIZATION_POLICY) {
      if (unprotected.has(entry.policy)) continue;
      expect(
        entry.negativeFixture,
        `${authorizationPolicyKey(entry.route, entry.method)} needs a negative fixture`,
      ).toBeTruthy();
    }
  });

  test("requires same-origin admission before browser mutations", () => {
    const serverTransports = new Set([
      "admin-mcp",
      "internal-capability",
      "public-mcp",
      "framework-auth",
    ]);
    for (const entry of API_AUTHORIZATION_POLICY) {
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(entry.method)) continue;
      if (serverTransports.has(entry.policy)) continue;
      const source = discoveredByKey.get(authorizationPolicyKey(entry.route, entry.method))?.source;
      if (entry.policy === "public" && entry.route === "analytics/event") continue;
      expect(entry.csrf, `${entry.route}#${entry.method} must declare browser CSRF semantics`)
        .toBe(true);
      expect(source, `${entry.route}#${entry.method} source`).toContain("sameOriginOr403");
    }
  });
});
