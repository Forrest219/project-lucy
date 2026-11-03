/**
 * L25-16 — 源表导入的**原子组划分**（Spec §6.3 / D7 / R11 / N04 / F07，S4 第 2 / 8 / 10 项）。
 *
 * ⚠️ **组的身份由实际写集交集决定**，不得只用 Schema 近似：
 *
 * - Manifest：`semantic-layer/<conn>/_schema/<schema>.yaml` —— 同连接同 Schema 的多表共享；
 * - Overlay：`semantic-layer/<conn>/<table>.yaml` —— **路径中不含 Schema**，故同连接不同
 *   Schema 的同名表也写同一文件；
 * - 版本快照与历史索引 `.ktx-ui/table-yaml-history/` —— **全局单一索引文件**，属**共享元数据**，
 *   **不参与分组判定**（否则所有需建版本快照的目标都退化成一个大组，D7 的原子性边界失效），
 *   但必须**按条目隔离**：撤销只回滚本组条目。
 */

export interface OpsSourceGroupInput {
  /** 目标稳定 id。 */
  id: string;
  /** 该目标会写的**共享内容文件**（不含全局历史索引）。 */
  contentFiles: string[];
}

export interface OpsSourceGroup {
  id: string;
  memberIds: string[];
  /** 组内共享的内容文件清单。 */
  sharedFiles: string[];
}

/**
 * 按**写集交集**划分原子组（并查集）。
 *
 * 两个目标只要写同一个内容文件，就必须落在同一个原子组——共享文件不可部分回滚。
 * 写集不相交的组互不阻断（组间部分成功可重放）。
 */
export function formOpsSourceGroups(inputs: readonly OpsSourceGroupInput[]): OpsSourceGroup[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    if (root === id) return id;
    root = find(root);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const a = find(left);
    const b = find(right);
    if (a === b) return;
    // 稳定合并：小的 id 作为根，保证组 id 与组内顺序可复现。
    if (a < b) parent.set(b, a);
    else parent.set(a, b);
  };

  for (const input of inputs) parent.set(input.id, input.id);

  // 文件 → 首个使用它的目标；后续使用者与它同组。
  const fileOwner = new Map<string, string>();
  for (const input of inputs) {
    for (const file of input.contentFiles) {
      const owner = fileOwner.get(file);
      if (owner === undefined) {
        fileOwner.set(file, input.id);
        continue;
      }
      union(owner, input.id);
    }
  }

  const groups = new Map<string, OpsSourceGroup>();
  for (const input of inputs) {
    const root = find(input.id);
    const group = groups.get(root) ?? { id: root, memberIds: [], sharedFiles: [] };
    group.memberIds.push(input.id);
    groups.set(root, group);
  }

  // 组内共享文件清单 = 组内成员写集之并（去重、排序）。
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const result: OpsSourceGroup[] = [];
  for (const group of groups.values()) {
    const files = new Set<string>();
    for (const memberId of group.memberIds) {
      for (const file of byId.get(memberId)?.contentFiles ?? []) files.add(file);
    }
    result.push({
      id: group.id,
      memberIds: group.memberIds,
      sharedFiles: [...files].sort()
    });
  }
  result.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return result;
}

/**
 * 组内**共享文件的内容冲突**检测。
 *
 * 同一个共享文件被组内多个目标写入**不同内容**时，一次文件写无法同时满足两者——
 * 必须整组失败（不得「最后一个写入者赢」把前一个的内容抹掉）。
 *
 * @param proposals 共享内容文件 → 各目标为它提出的内容。
 * @returns 冲突的文件清单（空数组 = 无冲突）。
 */
export function detectOpsSourceWriteConflicts(
  proposals: ReadonlyMap<string, ReadonlyMap<string, string>>
): string[] {
  const conflicts: string[] = [];
  for (const [filePath, byTarget] of proposals) {
    const contents = new Set(byTarget.values());
    if (contents.size > 1) conflicts.push(filePath);
  }
  return conflicts.sort();
}
