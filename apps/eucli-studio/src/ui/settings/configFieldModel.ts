import { cloneConfigValue } from '../../domain/toolConfigDraft'
import { plainObject, stringField } from './schemaFieldValues'

// 工具配置表单的字段模型：把工具声明的「字段描述」编译成可渲染的字段树，
// 并提供配置草稿的点路径读写（对象键与列表下标统一寻址）。
//
// 字段描述规范（表单渲染约定）：
// - 单值：string / integer / number / boolean；
// - 枚举：string + enum（可配 enumLabels）；
// - 对象：type=object，按 properties 渲染；未声明结构时按现有键渲染；
// - 字符串列表：type=array 且条目为 string（或缺省声明）→ 一行一个值；
// - 对象行列表：type=array 且条目为 object → 动态行，可增删；
// - 其他形状：由表单以 JSON 原文兜底渲染。

export type ConfigArrayItemKind = 'none' | 'string' | 'object' | 'other'

export type ConfigOption = {
  value: string
  label: string
}

export type ConfigField = {
  path: string[]
  key: string
  label: string
  description: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  enumOptions: ConfigOption[]
  required: boolean
  currentValue: any
  defaultValue: any
  schema: Record<string, any>
  itemKind: ConfigArrayItemKind
  itemTitle: string
}

// buildConfigFields 构建草稿顶层的全部可渲染字段。
export function buildConfigFields(schemaRaw: any, defaultConfigRaw: any, userConfigRaw: any, draftConfigRaw: any): ConfigField[] {
  const schema = plainObject(schemaRaw)
  const defaultConfig = plainObject(defaultConfigRaw)
  const userConfig = plainObject(userConfigRaw)
  const draftConfig = plainObject(draftConfigRaw)
  return buildChildFields([], schema, defaultConfig, draftConfig)
}

// buildObjectChildFields 构建对象字段的子字段：声明结构、默认值与现有键三者取并集。
export function buildObjectChildFields(schemaRaw: any, valueRaw: any, pathPrefix: string[], defaultRaw?: any): ConfigField[] {
  const schema = plainObject(schemaRaw)
  const value = plainObject(valueRaw)
  return buildChildFields(pathPrefix, schema, plainObject(defaultRaw), value)
}

// buildArrayItemFields 构建对象行列表中某一行的字段。
export function buildArrayItemFields(itemSchemaRaw: any, itemValueRaw: any, pathPrefix: string[]): ConfigField[] {
  return buildObjectChildFields(itemSchemaRaw, itemValueRaw, pathPrefix)
}

// arrayItemSeed 生成新增行的种子：条目声明的 default 为底，再补齐各字段声明的 default。
export function arrayItemSeed(itemSchemaRaw: any): any {
  const itemSchema = plainObject(itemSchemaRaw)
  let seed: any = hasOwn(itemSchema, 'default') ? cloneConfigValue(itemSchema.default) : {}
  if (!seed || typeof seed !== 'object' || Array.isArray(seed)) seed = {}
  const properties = plainObject(itemSchema.properties)
  for (const key of Object.keys(properties)) {
    const property = plainObject(properties[key])
    if (!hasOwn(seed, key) && hasOwn(property, 'default')) seed[key] = cloneConfigValue(property.default)
  }
  return seed
}

export function isBlankConfigValue(value: any): boolean {
  return value === undefined || value === null
}

// buildChildFields 是字段树构建的唯一入口：声明属性、默认值与现有值三者的键取并集，逐键成型。
function buildChildFields(pathPrefix: string[], schema: Record<string, any>, defaults: Record<string, any>, values: Record<string, any>): ConfigField[] {
  const required = new Set(stringArray(schema.required))
  const properties = plainObject(schema.properties)
  const keys = orderedUniqueStrings([...Object.keys(properties), ...Object.keys(defaults), ...Object.keys(values)])
  return keys.map((key) => {
    const propertySchema = plainObject(properties[key])
    const defaultValue = hasOwn(defaults, key) ? defaults[key] : propertySchema.default
    return makeField(pathPrefix, key, propertySchema, values[key], defaultValue, required.has(key))
  })
}

function makeField(pathPrefix: string[], key: string, propertySchema: Record<string, any>, currentValue: any, defaultValue: any, required: boolean): ConfigField {
  return {
    path: [...pathPrefix, key],
    key,
    label: stringField(propertySchema.title) || key,
    description: stringField(propertySchema.description),
    type: inferFieldType(propertySchema, currentValue, defaultValue),
    enumOptions: enumOptionsFromSchema(propertySchema),
    required,
    currentValue,
    defaultValue,
    schema: propertySchema,
    itemKind: inferArrayItemKind(propertySchema, currentValue),
    itemTitle: stringField(plainObject(propertySchema.items).title),
  }
}

function inferFieldType(schema: Record<string, any>, currentValue: any, defaultValue: any): ConfigField['type'] {
  const rawType = String(schema.type || '').trim()
  if (rawType === 'boolean') return 'boolean'
  if (rawType === 'number' || rawType === 'integer') return 'number'
  if (rawType === 'object') return 'object'
  if (rawType === 'array') return 'array'
  const value = currentValue != null ? currentValue : defaultValue
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (Array.isArray(value)) return 'array'
  if (value && typeof value === 'object') return 'object'
  return 'string'
}

// inferArrayItemKind 判定列表条目的渲染形态：字符串列表、对象行列表或其他（JSON 兜底）。
function inferArrayItemKind(schema: Record<string, any>, currentValue: any): ConfigArrayItemKind {
  const items = plainObject(schema.items)
  const rawType = String(items.type || '').trim()
  if (rawType === 'string') return 'string'
  if (rawType === 'object') return 'object'
  if (rawType !== '') return 'other'
  // 未声明条目结构：按当前值判断；缺省按字符串列表处理。
  if (Array.isArray(currentValue) && currentValue.some((item) => item && typeof item === 'object' && !Array.isArray(item))) return 'object'
  return 'string'
}

function enumOptionsFromSchema(schema: Record<string, any>): ConfigOption[] {
  const labels = plainObject(schema.enumLabels || schema['x-enumLabels'])
  return stringArray(schema.enum).map((value) => ({ value, label: stringField(labels[value]) || value }))
}

function stringArray(value: any): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? '').trim()).filter(Boolean) : []
}

function orderedUniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = String(value ?? '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function hasOwn(obj: Record<string, any>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}
