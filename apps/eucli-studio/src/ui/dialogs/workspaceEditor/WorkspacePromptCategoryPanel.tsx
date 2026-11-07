import { WorkspacePromptSection } from './WorkspacePromptSection'

/** 提示词分类：这一屏锁死高度，滚动只发生在提示词文本框内部。 */
export function WorkspacePromptCategoryPanel(props: { controller: any; draft: any }) {
  return <WorkspacePromptSection controller={props.controller} draft={props.draft} />
}
