import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

export type CatalogScopeSchemaNode = {
  name: string;
  count: number;
};

export type CatalogScopeConnectionNode = {
  name: string;
  count: number;
  schemas: CatalogScopeSchemaNode[];
};

type CatalogScopeTreeProps = {
  totalCount: number;
  connections: CatalogScopeConnectionNode[];
  activeConnection: string;
  activeSchema: string;
  onSelectRoot: () => void;
  onSelectConnection: (connection: string) => void;
  onSelectSchema: (connection: string, schema: string) => void;
  onToggleConnection?: () => void;
};

type VisibleNode = {
  key: string;
  kind: "root" | "connection" | "schema";
  connection?: string;
};

const ROOT_KEY = "root";

function connectionKey(index: number): string {
  return `connection-${index}`;
}

function schemaKey(connectionIndex: number, schemaIndex: number): string {
  return `schema-${connectionIndex}-${schemaIndex}`;
}

export function CatalogScopeTree({
  totalCount,
  connections,
  activeConnection,
  activeSchema,
  onSelectRoot,
  onSelectConnection,
  onSelectSchema,
  onToggleConnection
}: CatalogScopeTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    activeConnection === "all" ? new Set() : new Set([activeConnection])
  );
  const [focusedKey, setFocusedKey] = useState(ROOT_KEY);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (activeConnection === "all") return;
    setExpanded((current) => {
      if (current.has(activeConnection)) return current;
      const next = new Set(current);
      next.add(activeConnection);
      return next;
    });
  }, [activeConnection]);

  useEffect(() => {
    if (activeConnection === "all") {
      setFocusedKey(ROOT_KEY);
      return;
    }
    const connectionIndex = connections.findIndex((candidate) => candidate.name === activeConnection);
    if (connectionIndex < 0) return;
    if (activeSchema === "all") {
      setFocusedKey(connectionKey(connectionIndex));
      return;
    }
    const schemaIndex = connections[connectionIndex]?.schemas.findIndex(
      (candidate) => candidate.name === activeSchema
    ) ?? -1;
    setFocusedKey(schemaIndex >= 0 ? schemaKey(connectionIndex, schemaIndex) : connectionKey(connectionIndex));
  }, [activeConnection, activeSchema, connections]);

  const visibleNodes = useMemo<VisibleNode[]>(() => {
    const nodes: VisibleNode[] = [{ key: ROOT_KEY, kind: "root" }];
    connections.forEach((connection, connectionIndex) => {
      nodes.push({
        key: connectionKey(connectionIndex),
        kind: "connection",
        connection: connection.name
      });
      if (expanded.has(connection.name)) {
        connection.schemas.forEach((_schema, schemaIndex) => {
          nodes.push({
            key: schemaKey(connectionIndex, schemaIndex),
            kind: "schema",
            connection: connection.name
          });
        });
      }
    });
    return nodes;
  }, [connections, expanded]);

  function focusNode(key: string) {
    setFocusedKey(key);
    itemRefs.current.get(key)?.focus();
  }

  function setConnectionExpanded(connection: string, nextExpanded: boolean, report = true) {
    setExpanded((current) => {
      const isExpanded = current.has(connection);
      if (isExpanded === nextExpanded) return current;
      const next = new Set(current);
      if (nextExpanded) next.add(connection);
      else next.delete(connection);
      return next;
    });
    if (report) onToggleConnection?.();
  }

  function activateConnection(connection: string) {
    setConnectionExpanded(connection, true, false);
    onSelectConnection(connection);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, node: VisibleNode) {
    const index = visibleNodes.findIndex((candidate) => candidate.key === node.key);
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? visibleNodes.length - 1
          : event.key === "ArrowDown"
            ? Math.min(index + 1, visibleNodes.length - 1)
            : Math.max(index - 1, 0);
      const nextNode = visibleNodes[nextIndex];
      if (nextNode) focusNode(nextNode.key);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (node.kind === "root") {
        const firstConnection = visibleNodes.find((candidate) => candidate.kind === "connection");
        if (firstConnection) focusNode(firstConnection.key);
      } else if (node.kind === "connection" && node.connection) {
        if (!expanded.has(node.connection)) {
          setConnectionExpanded(node.connection, true);
        } else {
          const firstChild = visibleNodes[index + 1];
          if (firstChild?.kind === "schema" && firstChild.connection === node.connection) {
            focusNode(firstChild.key);
          }
        }
      }
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node.kind === "schema" && node.connection) {
        const parent = visibleNodes.find(
          (candidate) => candidate.kind === "connection" && candidate.connection === node.connection
        );
        if (parent) focusNode(parent.key);
      } else if (node.kind === "connection" && node.connection) {
        if (expanded.has(node.connection)) setConnectionExpanded(node.connection, false);
        else focusNode(ROOT_KEY);
      }
    }
  }

  function treeItemProps(key: string) {
    return {
      ref: (node: HTMLButtonElement | null) => {
        if (node) itemRefs.current.set(key, node);
        else itemRefs.current.delete(key);
      },
      tabIndex: focusedKey === key ? 0 : -1,
      onFocus: () => setFocusedKey(key)
    };
  }

  const rootSelected = activeConnection === "all" && activeSchema === "all";

  return (
    <nav aria-label="语义资产范围" className="pl-catalog-scope-tree" data-testid="catalog-scope-tree">
      <h2 className="pl-catalog-scope-tree-title">
        <span>连接 / </span><span className="notranslate" translate="no">Schema</span>
      </h2>
      <ul
        aria-label="连接与 Schema"
        className="pl-catalog-tree-list notranslate"
        role="tree"
        translate="no"
      >
        <li role="none">
          <button
            {...treeItemProps(ROOT_KEY)}
            aria-level={1}
            aria-selected={rootSelected}
            className={clsx("pl-catalog-tree-item", rootSelected && "pl-catalog-tree-item--active")}
            data-testid="catalog-tree-root"
            onClick={onSelectRoot}
            onKeyDown={(event) => handleKeyDown(event, { key: ROOT_KEY, kind: "root" })}
            role="treeitem"
            type="button"
          >
            <span className="pl-catalog-tree-label">全部连接</span>
            <span className="pl-catalog-tree-count">{totalCount} 张表</span>
          </button>
        </li>
        {connections.map((connection, connectionIndex) => {
          const key = connectionKey(connectionIndex);
          const isExpanded = expanded.has(connection.name);
          const isSelected = activeConnection === connection.name && activeSchema === "all";
          return (
            <li key={connection.name} role="none">
              <div className="pl-catalog-tree-row">
                <button
                  aria-label={`${isExpanded ? "收起" : "展开"}连接 ${connection.name}`}
                  className="pl-catalog-tree-toggle"
                  data-testid={`catalog-tree-toggle-${connectionIndex}`}
                  onClick={() => setConnectionExpanded(connection.name, !isExpanded)}
                  tabIndex={-1}
                  type="button"
                >
                  <span aria-hidden>{isExpanded ? "▾" : "▸"}</span>
                </button>
                <button
                  {...treeItemProps(key)}
                  aria-expanded={isExpanded}
                  aria-level={2}
                  aria-selected={isSelected}
                  className={clsx("pl-catalog-tree-item", isSelected && "pl-catalog-tree-item--active")}
                  data-testid={`catalog-tree-connection-${connectionIndex}`}
                  onClick={() => activateConnection(connection.name)}
                  onKeyDown={(event) => handleKeyDown(event, {
                    key,
                    kind: "connection",
                    connection: connection.name
                  })}
                  role="treeitem"
                  type="button"
                >
                  <span className="pl-catalog-tree-label notranslate" title={connection.name} translate="no">
                    {connection.name}
                  </span>
                  <span className="pl-catalog-tree-count">{connection.count} 张表</span>
                </button>
              </div>
              {isExpanded ? (
                <ul className="pl-catalog-tree-group" role="group">
                  {connection.schemas.map((schema, schemaIndex) => {
                    const childKey = schemaKey(connectionIndex, schemaIndex);
                    const childSelected = activeConnection === connection.name && activeSchema === schema.name;
                    return (
                      <li key={schema.name} role="none">
                        <button
                          {...treeItemProps(childKey)}
                          aria-level={3}
                          aria-selected={childSelected}
                          className={clsx(
                            "pl-catalog-tree-item pl-catalog-tree-item--schema",
                            childSelected && "pl-catalog-tree-item--active"
                          )}
                          data-testid={`catalog-tree-schema-${connectionIndex}-${schemaIndex}`}
                          onClick={() => onSelectSchema(connection.name, schema.name)}
                          onKeyDown={(event) => handleKeyDown(event, {
                            key: childKey,
                            kind: "schema",
                            connection: connection.name
                          })}
                          role="treeitem"
                          type="button"
                        >
                          <span className="pl-catalog-tree-label notranslate" title={schema.name} translate="no">
                            {schema.name}
                          </span>
                          <span className="pl-catalog-tree-count">{schema.count} 张表</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
