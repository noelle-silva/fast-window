import type { UiOperation } from '../uiOperations'

type OperationBannerProps = {
  operation: UiOperation | null
}

export function OperationBanner(props: OperationBannerProps) {
  const { operation } = props
  if (!operation) return null
  return (
    <section className="everything-operation-banner" role="status" aria-live="polite">
      <div className="everything-operation-spinner" aria-hidden="true" />
      <div>
        <strong>{operation.title}</strong>
        <p>{operation.detail}</p>
      </div>
    </section>
  )
}
