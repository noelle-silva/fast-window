# Desktop Grid Module

`desktop-grid` is a business-neutral icon grid module for desktop-like UIs. It provides grid-coordinate layout, Muuri-powered dragging, repulsion-based placement, container preview support, container inner grids, and a container overlay shell.

## Boundary

The module owns:

- grid layout coordinates
- column measurement
- persisted-position normalization
- drag preview layout
- repulsion placement
- Muuri item synchronization
- desktop canvas rendering
- container inner canvas rendering
- container overlay shell

The host app owns:

- data loading and persistence
- app-specific item models
- resource URL resolution
- menus and actions
- edit dialogs
- errors and notifications
- wallpaper and page chrome

## Minimal Usage

```tsx
import {
  DesktopGridCanvas,
  DesktopGridItem,
  DefaultIconVisual,
  type DesktopGridEntry,
} from './shared/desktop-grid'

<DesktopGridCanvas
  entries={entries}
  onLayoutCommit={saveLayout}
  renderItem={(entry, state) => (
    <DesktopGridItem
      dragging={state.dragging}
      icon={<DefaultIconVisual className="desktop-grid-icon-surface" seed={entry.id} />}
      name={entry.name}
      onOpen={() => {
        if (!state.consumeClick()) openEntry(entry)
      }}
    />
  )}
/>
```

## Data Model

Items use stable IDs and grid coordinates:

```ts
type DesktopGridEntry = {
  id: string
  kind: 'item' | 'container'
  name: string
  layout?: { x: number; y: number }
}
```

## Drag Contract

The module emits layout patches instead of persisting data itself. Host apps should persist patches in their own storage layer.

## Container Contract

Containers are represented as normal desktop entries with `kind: 'container'`. The host app decides which items belong to a container and provides them to `ContainerGridCanvas`.
