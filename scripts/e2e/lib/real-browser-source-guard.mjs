import { createRequire } from "node:module";

const require = createRequire(new URL("../../../webui/package.json", import.meta.url));
const ts = require("typescript");

/** Inspect executable calls; examples in comments and ordinary strings are not network mocks. */
export function forbiddenBrowserCalls(source, filename = "case.ts") {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      const property = ts.isPropertyAccessExpression(expr) ? expr.name.text
        : ts.isElementAccessExpression(expr) && expr.argumentExpression && ts.isStringLiteral(expr.argumentExpression)
          ? expr.argumentExpression.text : null;
      const name = ts.isIdentifier(expr) ? expr.text : property;
      if (["route", "routeFromHAR", "mockApi", "mswServer"].includes(name)
        || (name === "fulfill" && ts.isPropertyAccessExpression(expr) && expr.expression.getText(file) === "route")) {
        found.push({ name, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
