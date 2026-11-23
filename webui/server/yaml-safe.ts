import { stringify, type DocumentOptions, type SchemaOptions, type ToStringOptions } from "yaml";

export type YamlStringifyOptions = DocumentOptions & SchemaOptions & ToStringOptions;

/**
 * P1-76 统一 YAML 写出口。
 *
 * `yaml.stringify` 默认对共享对象引用去重，序列化为 anchor/alias；KTX 以
 * `yaml` 解析器默认 `maxAliasCount: 100` 读取，超限即拒读
 * （"Excessive alias count indicates a resource exhaustion attack"）。
 * 仓库 YAML 产物规范禁止 anchor/alias（Spec §2 C1），复用定义必须 inline
 * 展开或按键引用，因此写出口默认 `aliasDuplicateObjects: false`。
 */
export function stringifySafe(value: unknown, options?: YamlStringifyOptions): string {
  return stringify(value, { ...options, aliasDuplicateObjects: false });
}
